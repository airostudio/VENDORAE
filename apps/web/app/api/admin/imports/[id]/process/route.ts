import { NextResponse } from "next/server";
import { createServiceRoleSupabaseClient } from "@trend/db";
import { parseCsvChunk, zipCsvRow } from "@trend/core";
import { upsertProductRows, markMissingProductsOutOfStock, type ProductCsvRecord, type ImportRowError } from "@/lib/import/product-import";
import { applyColumnMapping } from "@/lib/import/columnMapping";

export const runtime = "nodejs";
// Never prerender or cache an admin endpoint: Next will happily statically optimise a
// route whose GET succeeds at build time, after which every other method on it returns a
// bodiless 405 and the GET serves a stale build-time snapshot.
export const dynamic = "force-dynamic";
// Generous ceiling in case a chunk lands on a slow moment — the design
// doesn't *depend* on this being high (each chunk is small on purpose), but
// there's no reason not to leave headroom.
export const maxDuration = 60;

interface JobOptions {
  byteOffset: number;
  carryover: string;
  header: string[] | null;
  chunkBytes: number;
  markMissingOutOfStock?: boolean;
}
interface JobResult {
  processedRows: number;
  skippedExisting: number;
  errors: ImportRowError[];
  seenHandles: string[];
  seenBrands: string[];
  markedOutOfStock?: number;
}

const MAX_STORED_ERRORS = 200;
/**
 * How long one invocation may spend downloading images before it stops and reports the rest.
 * Well inside maxDuration so the writes that follow always get to run.
 */
const IMAGE_FETCH_BUDGET_MS = 30_000;

/**
 * Image-host credentials arrive with each call and are used only for that call — never written to
 * the job row or anywhere else. The admin's browser holds them for the duration of the import,
 * which keeps a third party's password out of this store's database entirely.
 */
interface ImageSettings {
  rehost: boolean;
  credentials: { username: string; password: string } | null;
}

function readImageSettings(body: unknown): ImageSettings {
  const value = body as { rehostImages?: unknown; imageUsername?: unknown; imagePassword?: unknown } | null;
  const username = typeof value?.imageUsername === "string" ? value.imageUsername : "";
  const password = typeof value?.imagePassword === "string" ? value.imagePassword : "";
  return {
    rehost: value?.rehostImages === true,
    credentials: username && password ? { username, password } : null,
  };
}

/**
 * Processes ONE bounded byte-range slice of the CSV per call. The caller
 * (the admin UI) calls this repeatedly until `done: true` — that's the
 * "internal chunking" that lets an arbitrarily large file get fully
 * imported without any single request/function invocation ever touching
 * more than `chunkBytes` of the file or running for more than a fraction of
 * a second of real work.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const startedAt = Date.now();
  const imageSettings = readImageSettings(await request.json().catch(() => null));
  const supabase = createServiceRoleSupabaseClient();

  const { data: job, error: jobErr } = await supabase.from("import_jobs").select("*").eq("id", params.id).single();
  if (jobErr || !job) return NextResponse.json({ error: "Import job not found" }, { status: 404 });

  if (job.status === "COMPLETED" || job.status === "FAILED") {
    return NextResponse.json({ done: true, progress: job.progress, result: job.result });
  }

  const options = job.options as JobOptions;
  const result = job.result as JobResult;

  const { data: signed, error: signErr } = await supabase.storage.from("imports").createSignedUrl(job.file_url, 60);
  if (signErr || !signed) {
    await supabase.from("import_jobs").update({ status: "FAILED", result: { ...result, errors: [...result.errors, { rowNumber: -1, message: `Could not sign download URL: ${signErr?.message}` }] } }).eq("id", params.id);
    return NextResponse.json({ error: "Could not access uploaded file" }, { status: 500 });
  }

  const rangeStart = options.byteOffset;
  const rangeEnd = rangeStart + options.chunkBytes - 1;
  const res = await fetch(signed.signedUrl, { headers: { Range: `bytes=${rangeStart}-${rangeEnd}` } });

  if (!(res.status === 206 || res.status === 200)) {
    await supabase.from("import_jobs").update({ status: "FAILED" }).eq("id", params.id);
    return NextResponse.json({ error: `Unexpected storage response: ${res.status}` }, { status: 502 });
  }

  const chunkText = await res.text();
  const contentRange = res.headers.get("content-range"); // "bytes start-end/total"
  const totalBytes = contentRange ? Number.parseInt(contentRange.split("/")[1], 10) : undefined;

  const isFirstChunk = rangeStart === 0;
  const text = options.carryover + chunkText;
  const { rows: parsedRows, leftover } = parseCsvChunk(text);

  let header = options.header;
  let dataRows = parsedRows;
  if (isFirstChunk) {
    header = parsedRows[0]?.map((h) => h.trim()) ?? [];
    dataRows = parsedRows.slice(1);
  }

  // The admin confirmed which of this file's headings feed which importer field before uploading;
  // apply that here so the rest of the pipeline only ever sees canonical keys. A job without a
  // stored mapping treats the file's own headings as canonical, as imports did before mapping.
  const fieldMap = (job.mapping as { fields?: Record<string, string | null> | null } | null)?.fields ?? null;
  const records = dataRows.map((row, i) => ({
    rowNumber: (result.processedRows ?? 0) + i + 1,
    data: (header ? applyColumnMapping(zipCsvRow(header, row), fieldMap) : {}) as ProductCsvRecord,
  }));

  let chunkOutcome = { processed: 0, errors: [] as ImportRowError[], skippedExisting: 0, seenHandles: [] as string[], seenBrands: [] as string[] };
  if (header && records.length > 0) {
    chunkOutcome = await upsertProductRows(supabase, job.tenant_id, records, {
      rehost: imageSettings.rehost,
      credentials: imageSettings.credentials,
      // Leave room inside this invocation's budget for the writes that follow the fetching.
      deadline: startedAt + IMAGE_FETCH_BUDGET_MS,
    });
  }

  // Determine how far into the file we actually consumed. Bytes actually
  // received may be less than requested near EOF (or if the range wasn't
  // honored and the whole remainder came back at once).
  const bytesReceived = Buffer.byteLength(chunkText, "utf8");
  const newByteOffset = rangeStart + bytesReceived;
  const reachedEnd = totalBytes !== undefined ? newByteOffset >= totalBytes : bytesReceived < options.chunkBytes;

  const nextOptions: JobOptions = {
    byteOffset: newByteOffset,
    carryover: reachedEnd ? "" : leftover,
    header,
    chunkBytes: options.chunkBytes,
    markMissingOutOfStock: options.markMissingOutOfStock,
  };
  // Handles/brands accumulate across every chunk — the final chunk's pass
  // (below) needs the full set seen across the whole file, not just this slice.
  const seenHandles = [...new Set([...(result.seenHandles ?? []), ...chunkOutcome.seenHandles])];
  const seenBrands = [...new Set([...(result.seenBrands ?? []), ...chunkOutcome.seenBrands])];
  let markedOutOfStock = result.markedOutOfStock;

  if (reachedEnd && options.markMissingOutOfStock) {
    const outcome = await markMissingProductsOutOfStock(supabase, job.tenant_id, seenHandles, seenBrands);
    markedOutOfStock = outcome.markedProducts;
    if (outcome.error) {
      // Non-fatal — the import itself already succeeded, this is a best-effort follow-up pass.
    }
  }

  const nextResult: JobResult = {
    processedRows: (result.processedRows ?? 0) + chunkOutcome.processed,
    skippedExisting: (result.skippedExisting ?? 0) + chunkOutcome.skippedExisting,
    errors: [...(result.errors ?? []), ...chunkOutcome.errors].slice(-MAX_STORED_ERRORS),
    seenHandles,
    seenBrands,
    markedOutOfStock,
  };
  const progress = totalBytes ? Math.min(100, Math.round((newByteOffset / totalBytes) * 100)) : reachedEnd ? 100 : job.progress;

  if (reachedEnd) {
    // Visible in Vercel runtime logs — the fastest way to confirm an import
    // actually wrote rows (or see why it didn't) without direct DB access.
    console.log(
      `[import ${params.id}] done: processed=${nextResult.processedRows} skippedExisting=${nextResult.skippedExisting} errors=${nextResult.errors.length} tenant=${job.tenant_id}`,
    );
  }

  await supabase
    .from("import_jobs")
    .update({
      status: reachedEnd ? "COMPLETED" : "RUNNING",
      options: nextOptions,
      result: nextResult,
      progress,
    })
    .eq("id", params.id);

  return NextResponse.json({ done: reachedEnd, progress, processedThisChunk: chunkOutcome.processed, result: nextResult });
}
