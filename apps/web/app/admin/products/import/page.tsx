"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  PRODUCT_IMPORT_FIELDS,
  parseHeaderRow,
  suggestColumnMapping,
  REQUIRED_IMPORT_FIELDS,
} from "@/lib/import/columnMapping";

type Mode = "csv" | "woocommerce" | "aliexpress";
type Phase = "idle" | "uploading" | "processing" | "done" | "error";

interface ImportRowError {
  rowNumber: number;
  handle?: string;
  message: string;
}

interface ConversionSummary {
  totalRows: number;
  excludedTitles: string[];
  typeCounts: Record<string, number>;
}

type LineStatus = "queued" | "staging" | "staged" | "failed";

interface BulkLine {
  key: string;
  input: string;
  productId: string | null;
  status: LineStatus;
  title: string | null;
  error: string | null;
}

const MAX_BULK_LINES = 50;

const MODE_CONFIG: Record<Mode, { label: string; accept: string; createEndpoint: string; contentType: string }> = {
  csv: {
    label: "CSV",
    accept: ".csv,text/csv",
    createEndpoint: "/api/admin/imports",
    contentType: "text/csv",
  },
  woocommerce: {
    label: "WooCommerce Export (.xlsx)",
    accept: ".xlsx",
    createEndpoint: "/api/admin/imports/woocommerce",
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  // Not file-based — the AliExpress mode has its own dedicated UI/handler below and never calls runImport().
  aliexpress: { label: "AliExpress", accept: "", createEndpoint: "", contentType: "" },
};

/** Pulls the numeric product id out of an AliExpress product URL, or passes through a bare id. */
function extractAliExpressProductId(input: string): string | null {
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/aliexpress\.[a-z.]+\/item\/(?:.*\/)?(\d+)\.html/i) ?? trimmed.match(/[?&]productId=(\d+)/i);
  if (urlMatch) return urlMatch[1];
  if (/^\d+$/.test(trimmed)) return trimmed;
  return null;
}

export default function ProductImportPage() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>("csv");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [processedRows, setProcessedRows] = useState(0);
  const [skippedExisting, setSkippedExisting] = useState(0);
  const [markedOutOfStock, setMarkedOutOfStock] = useState<number | undefined>(undefined);
  const [markMissingOutOfStock, setMarkMissingOutOfStock] = useState(false);
  const [errors, setErrors] = useState<ImportRowError[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [summary, setSummary] = useState<ConversionSummary | null>(null);

  // A chosen CSV waits here while the admin confirms which of its headings feed which field.
  // Image-host login, held in this page only for the life of the import and sent with each chunk.
  // Deliberately never stored: it's a third party's password, and nothing here needs it afterwards.
  // On by default: a source image that isn't https can't be displayed at all if we merely link to
  // it, and most supplier/WooCommerce exports point at http or login-protected hosts.
  const [rehostImages, setRehostImages] = useState(true);
  const [imageUsername, setImageUsername] = useState("");
  const [imagePassword, setImagePassword] = useState("");

  const [pendingCsv, setPendingCsv] = useState<{ file: File; headers: string[] } | null>(null);
  const [fieldMap, setFieldMap] = useState<Record<string, string | null>>({});

  const [aliexpressInput, setAliexpressInput] = useState("");
  const [aliexpressSearch, setAliexpressSearch] = useState("");
  const [bulkLines, setBulkLines] = useState<BulkLine[]>([]);
  const [staging, setStaging] = useState(false);
  const [stagedCount, setStagedCount] = useState<number | null>(null);

  // How many products are already sitting in the review queue, so the page can point at it.
  useEffect(() => {
    fetch("/api/admin/products/aliexpress/staged")
      .then((res) => res.json())
      .then((data) => setStagedCount(Array.isArray(data.staged) ? data.staged.length : null))
      .catch(() => setStagedCount(null));
  }, []);

  function openAliExpressSearch() {
    const url = aliexpressSearch.trim()
      ? `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(aliexpressSearch.trim())}`
      : "https://www.aliexpress.com/";
    window.open(url, "_blank", "noopener,noreferrer");
  }

  /**
   * Stages every pasted line, one request per product. Sequential on purpose: each call does a
   * live AliExpress fetch plus an AI rewrite, so this keeps every request small (no function
   * timeout on a big batch) and lets the admin watch each line resolve or fail on its own.
   */
  async function stageBulk() {
    const rawLines = aliexpressInput
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (rawLines.length === 0) {
      setMessage("Paste at least one AliExpress product link — one per line.");
      return;
    }
    if (rawLines.length > MAX_BULK_LINES) {
      setMessage(`That's ${rawLines.length} lines — please paste at most ${MAX_BULK_LINES} at a time.`);
      return;
    }

    setMessage(null);
    const lines: BulkLine[] = rawLines.map((input, i) => {
      const productId = extractAliExpressProductId(input);
      return {
        key: `${i}-${input}`,
        input,
        productId,
        status: productId ? "queued" : "failed",
        title: null,
        error: productId ? null : "Not a recognisable AliExpress product link or id",
      };
    });
    setBulkLines(lines);
    setStaging(true);

    for (const line of lines) {
      if (!line.productId) continue;
      setBulkLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, status: "staging" } : l)));
      try {
        const res = await fetch("/api/admin/products/aliexpress/stage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId: line.productId, sourceUrl: line.input }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not stage this product");
        setBulkLines((prev) =>
          prev.map((l) =>
            l.key === line.key
              ? data.status === "failed"
                ? { ...l, status: "failed", error: data.error ?? "AliExpress rejected this product" }
                : { ...l, status: "staged", title: data.title }
              : l,
          ),
        );
      } catch (err) {
        setBulkLines((prev) =>
          prev.map((l) =>
            l.key === line.key ? { ...l, status: "failed", error: err instanceof Error ? err.message : "Could not stage" } : l,
          ),
        );
      }
    }

    setStaging(false);
    fetch("/api/admin/products/aliexpress/staged")
      .then((res) => res.json())
      .then((data) => setStagedCount(Array.isArray(data.staged) ? data.staged.length : null))
      .catch(() => undefined);
  }

  // Required fields still unmapped block the import; everything else is the admin's call.
  const missingRequired = REQUIRED_IMPORT_FIELDS.filter((key) => !fieldMap[key]).map(
    (key) => PRODUCT_IMPORT_FIELDS.find((f) => f.key === key)?.label ?? key,
  );
  const mappedHeaders = new Set(Object.values(fieldMap).filter((h): h is string => Boolean(h)));
  const unmappedHeaders = (pendingCsv?.headers ?? []).filter((h) => !mappedHeaders.has(h));

  const stagedOk = bulkLines.filter((l) => l.status === "staged").length;
  const stagedFailed = bulkLines.filter((l) => l.status === "failed").length;
  const pastedCount = aliexpressInput.split("\n").map((l) => l.trim()).filter(Boolean).length;

  /**
   * Reads just the heading row and proposes a mapping, so the admin can correct it before a single
   * row is imported. Only the first slice of the file is read — a large export never has to be
   * pulled into memory to find out what its columns are called.
   */
  async function prepareCsvMapping(file: File) {
    setMessage(null);
    setSummary(null);
    setErrors([]);
    try {
      const headers = parseHeaderRow(await file.slice(0, 64 * 1024).text());
      if (headers.length === 0) {
        setMessage("That file doesn't have a readable header row — the first line should name the columns.");
        return;
      }
      setPendingCsv({ file, headers });
      setFieldMap(suggestColumnMapping(headers));
    } catch {
      setMessage("Could not read that file's header row.");
    }
  }

  async function runImport(file: File, columnMap?: Record<string, string | null>) {
    const config = MODE_CONFIG[mode];
    setPendingCsv(null);
    setPhase("uploading");
    setProgress(0);
    setProcessedRows(0);
    setSkippedExisting(0);
    setMarkedOutOfStock(undefined);
    setErrors([]);
    setMessage(null);
    setSummary(null);

    try {
      // 1) Get a signed upload URL and PUT the file straight to storage —
      // this request never carries the file's bytes, only JSON.
      const uploadUrlRes = await fetch("/api/admin/imports/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name }),
      });
      if (!uploadUrlRes.ok) throw new Error("Could not get an upload URL");
      const { path, signedUrl } = await uploadUrlRes.json();

      // 2) Upload directly to storage. This is the step that would otherwise
      // hit a serverless function's request-body ceiling for a large file —
      // going straight to storage sidesteps it entirely.
      const putRes = await fetch(signedUrl, { method: "PUT", headers: { "Content-Type": config.contentType }, body: file });
      if (!putRes.ok) throw new Error("Upload to storage failed");

      // 3) Register the import job. For WooCommerce this also converts the
      // workbook to the standard CSV format server-side first.
      const createRes = await fetch(config.createEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, markMissingOutOfStock, fieldMap: columnMap }),
      });
      if (!createRes.ok) {
        const body = await createRes.json().catch(() => null);
        throw new Error(body?.error ?? "Could not create the import job");
      }
      const created = await createRes.json();
      if (mode === "woocommerce") {
        setSummary({ totalRows: created.totalRows, excludedTitles: created.excludedTitles ?? [], typeCounts: created.typeCounts ?? {} });
      }

      // 4) Drive it to completion — one small byte-range chunk per call, so
      // no single request ever has to parse or upsert the whole file.
      setPhase("processing");
      let done = false;
      while (!done) {
        const processRes = await fetch(`/api/admin/imports/${created.id}/process`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rehostImages, imageUsername, imagePassword }),
        });
        if (!processRes.ok) throw new Error("A chunk failed to process");
        const chunk = await processRes.json();
        done = chunk.done;
        setProgress(chunk.progress ?? 0);
        setProcessedRows(chunk.result?.processedRows ?? 0);
        setSkippedExisting(chunk.result?.skippedExisting ?? 0);
        setMarkedOutOfStock(chunk.result?.markedOutOfStock);
        setErrors(chunk.result?.errors ?? []);
      }

      setPhase("done");
    } catch (err) {
      setPhase("error");
      setMessage(err instanceof Error ? err.message : "Import failed");
    }
  }

  const busy = phase === "uploading" || phase === "processing";

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <Link href="/admin/products" className="text-xs text-stone-500 underline">
          ← Back to Products
        </Link>
      </div>
      <h1 className="font-serif text-3xl mb-3">Import Products</h1>
      <p className="text-sm text-stone-500 mb-8">
        Handles files of any size — the upload goes straight to storage, then gets processed in small
        byte-range chunks (a few hundred KB at a time) so nothing ever hits a request-size or execution-time
        ceiling, however large the file is.
      </p>

      <div className="flex gap-2 mb-8">
        {(Object.keys(MODE_CONFIG) as Mode[]).map((m) => (
          <button
            key={m}
            disabled={busy}
            onClick={() => {
              setMode(m);
              setPhase("idle");
              setSummary(null);
              setErrors([]);
              setMessage(null);
            }}
            className={`text-xs tracking-widest2 uppercase px-4 py-2 border ${
              mode === m ? "border-ink-950 bg-ink-950 text-warm-50" : "border-stone-300 text-stone-500"
            }`}
          >
            {MODE_CONFIG[m].label}
          </button>
        ))}
      </div>

      {mode === "csv" && (
        <div className="border border-stone-200 p-6 mb-8">
          <p className="text-xs font-medium mb-2">Expected columns</p>
          <p className="text-xs text-stone-500 leading-relaxed">
            handle, title, product_type, short_description, description, price, compare_at, sku, stock_on_hand,
            category_handles (pipe- or comma-separated existing category handles), brand, material, height_cm, status,
            image_urls (pipe- or comma-separated, already-hosted image URLs — first is used as the primary image)
          </p>
        </div>
      )}
      {mode === "woocommerce" && (
        <div className="border border-stone-200 p-6 mb-8">
          <p className="text-xs font-medium mb-2">What this does</p>
          <p className="text-xs text-stone-500 leading-relaxed">
            Upload a WooCommerce product-export .xlsx directly. Converted server-side into the
            same import format — product type and category are classified from the title and WooCommerce categories,
            material/height are parsed from the embedded spec table, and every row lands as{" "}
            <span className="font-medium">DRAFT</span> for review before publishing. Images are referenced from the
            source site's own URLs, not re-hosted here.
          </p>
        </div>
      )}
      {mode === "aliexpress" && (
        <div className="border border-stone-200 p-6 mb-8">
          <p className="text-xs font-medium mb-2">Step 1 — Find a product</p>
          <p className="text-xs text-stone-500 leading-relaxed mb-4">
            AliExpress doesn&rsquo;t allow its pages to open inside another site, so search opens in a new tab.
            Browse or search normally there, then come back here and paste the product&rsquo;s link below.
          </p>
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={aliexpressSearch}
              onChange={(e) => setAliexpressSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") openAliExpressSearch();
              }}
              placeholder="e.g. woven beach bag"
              className="flex-1 border border-stone-300 px-3 py-2 text-sm"
            />
            <button className="btn-secondary whitespace-nowrap" onClick={openAliExpressSearch}>
              Search AliExpress ↗
            </button>
          </div>

          <p className="text-xs font-medium mb-2 mt-6">Step 2 &mdash; Paste the products, one link per line</p>
          <p className="text-xs text-stone-500 leading-relaxed mb-4">
            Paste up to {MAX_BULK_LINES} product links at once, one per line. Each is fetched from AliExpress,
            priced by your rule, rewritten for SEO and given a suggested category, then parked on the{" "}
            <span className="font-medium">staging page</span> for review. Nothing reaches the store until you
            confirm it there.
          </p>
          <textarea
            value={aliexpressInput}
            onChange={(e) => setAliexpressInput(e.target.value)}
            rows={8}
            placeholder={"https://www.aliexpress.com/item/1005006308361133.html\nhttps://www.aliexpress.com/item/1005007112223334.html\n1005006999888777"}
            className="w-full border border-stone-300 px-3 py-2 text-sm font-mono mb-2"
            disabled={staging}
          />
          <div className="flex items-center gap-3 mb-4">
            <button className="btn-primary" disabled={staging || pastedCount === 0} onClick={stageBulk}>
              {staging ? "Staging\u2026" : `Stage ${pastedCount || ""} product${pastedCount === 1 ? "" : "s"}`.trim()}
            </button>
            <span className="text-xs text-stone-500">
              {pastedCount} line{pastedCount === 1 ? "" : "s"} pasted
            </span>
          </div>
          {message && <p className="text-sm text-red-600 mb-4">{message}</p>}

          {bulkLines.length > 0 && (
            <div className="border border-stone-200 mb-4">
              <div className="px-3 py-2 border-b border-stone-200 text-xs text-stone-600 flex justify-between">
                <span>
                  {stagedOk} staged{stagedFailed > 0 && ` \u00b7 ${stagedFailed} failed`}
                </span>
                <span className="text-stone-400">{staging ? "Working\u2026" : "Done"}</span>
              </div>
              <ul className="max-h-64 overflow-y-auto text-xs">
                {bulkLines.map((line) => (
                  <li key={line.key} className="px-3 py-2 border-b border-stone-100 flex gap-3">
                    <span className="w-16 flex-shrink-0 text-stone-400">
                      {line.status === "queued" && "queued"}
                      {line.status === "staging" && "fetching"}
                      {line.status === "staged" && "\u2713 staged"}
                      {line.status === "failed" && <span className="text-red-600">failed</span>}
                    </span>
                    <span className="flex-1 min-w-0 truncate">{line.title ?? line.input}</span>
                    {line.error && <span className="text-red-600 flex-shrink-0 max-w-[45%] truncate">{line.error}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-xs font-medium mb-2 mt-6">Step 3 &mdash; Review and confirm</p>
          <p className="text-xs text-stone-500 leading-relaxed mb-3">
            Open the staging page to see every product with its images, adjust the copy, pricing, images and
            category, then confirm the ones you want live.
          </p>
          <Link href="/admin/aliexpress/staging" className="btn-secondary inline-block">
            Go to staging{stagedCount !== null && stagedCount > 0 ? ` (${stagedCount})` : ""} &rarr;
          </Link>
        </div>
      )}

      {mode !== "aliexpress" && (
        <>
          <label className="flex items-start gap-2 mb-6 text-xs text-stone-600 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={markMissingOutOfStock}
              disabled={busy}
              onChange={(e) => setMarkMissingOutOfStock(e.target.checked)}
            />
            <span>
              Mark products not in this file as <span className="font-medium">Out Of Stock</span>. Existing products
              are always left alone by default — this only affects products sharing a brand with the imported file
              whose handle doesn&apos;t appear in it (their stock is set to 0; they are not deleted or unpublished).
            </span>
          </label>


          <div className="mb-6 border border-stone-200 p-4">
            <label className="flex items-start gap-2 text-xs text-stone-600 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={rehostImages}
                disabled={busy}
                onChange={(e) => setRehostImages(e.target.checked)}
              />
              <span>
                <span className="font-medium">Copy images into this store</span> instead of linking to them. Needed
                when the images sit behind a login, or are served over plain http — a customer&rsquo;s browser can load
                neither, so linking to them leaves the catalogue full of broken images.
              </span>
            </label>

            {rehostImages && (
              <div className="mt-3 pl-6">
                <p className="text-xs text-stone-500 mb-2">
                  If the image host needs a login, enter it here. It is used only to download the images during this
                  import and is never saved.
                </p>
                <div className="flex flex-wrap gap-3">
                  <input
                    type="text"
                    autoComplete="off"
                    placeholder="Username (optional)"
                    value={imageUsername}
                    disabled={busy}
                    onChange={(e) => setImageUsername(e.target.value)}
                    className="border border-stone-300 px-3 py-2 text-sm"
                  />
                  <input
                    type="password"
                    autoComplete="new-password"
                    placeholder="Password (optional)"
                    value={imagePassword}
                    disabled={busy}
                    onChange={(e) => setImagePassword(e.target.value)}
                    className="border border-stone-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>
            )}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept={MODE_CONFIG[mode].accept}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              // .xlsx is converted to canonical columns server-side, so only CSV needs mapping.
              if (mode === "csv") prepareCsvMapping(file);
              else runImport(file);
              e.target.value = "";
            }}
          />

          <button className="btn-primary" disabled={busy} onClick={() => fileInput.current?.click()}>
            {phase === "idle" && !pendingCsv && `Choose ${mode === "csv" ? "CSV" : ".xlsx"} File`}
            {phase === "idle" && pendingCsv && "Choose a different file"}
            {phase === "uploading" && "Uploading…"}
            {phase === "processing" && "Processing…"}
            {(phase === "done" || phase === "error") && "Import Another File"}
          </button>

          {pendingCsv && (
            <div className="mt-6 border border-stone-300 p-5">
              <h3 className="font-serif text-lg mb-1">Match your columns</h3>
              <p className="text-xs text-stone-600 mb-4">
                <span className="font-medium">{pendingCsv.file.name}</span> has {pendingCsv.headers.length} column
                {pendingCsv.headers.length === 1 ? "" : "s"}. These are our best guesses — check them, fix anything
                wrong, then import. Nothing is read from the file until you do.
              </p>

              <div className="grid sm:grid-cols-2 gap-x-8 gap-y-3 mb-4">
                {PRODUCT_IMPORT_FIELDS.map((field) => {
                  const value = fieldMap[field.key] ?? "";
                  const needsChoice = field.required && !value;
                  return (
                    <label key={field.key} className="text-sm">
                      <span className="block text-xs mb-1">
                        {field.label}
                        {field.required && <span className="text-red-600"> *</span>}
                        {field.hint && <span className="text-stone-400"> — {field.hint}</span>}
                      </span>
                      <select
                        value={value}
                        disabled={busy}
                        onChange={(e) =>
                          setFieldMap((prev) => ({ ...prev, [field.key]: e.target.value || null }))
                        }
                        className={`w-full border px-3 py-2 text-sm ${needsChoice ? "border-red-400" : "border-stone-300"}`}
                      >
                        <option value="">— not imported —</option>
                        {pendingCsv.headers.map((header) => (
                          <option key={header} value={header}>
                            {header}
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                })}
              </div>

              {unmappedHeaders.length > 0 && (
                <p className="text-xs text-stone-500 mb-4">
                  Not imported from your file: {unmappedHeaders.join(", ")}. Map a column above if any of these should
                  come through.
                </p>
              )}

              {missingRequired.length > 0 && (
                <p className="text-xs text-red-600 mb-4">
                  Choose a column for {missingRequired.join(" and ")} — a row without{" "}
                  {missingRequired.length === 1 ? "it" : "them"} can&apos;t be imported.
                </p>
              )}

              <div className="flex gap-3">
                <button
                  className="btn-primary"
                  disabled={busy || missingRequired.length > 0}
                  onClick={() => runImport(pendingCsv.file, fieldMap)}
                >
                  Import {pendingCsv.file.name}
                </button>
                <button className="btn-secondary" disabled={busy} onClick={() => setPendingCsv(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {summary && (
        <div className="mt-6 border border-stone-200 p-4 text-xs text-stone-600">
          <p className="mb-1">
            <span className="font-medium">{summary.totalRows}</span> product row(s) converted
            {summary.excludedTitles.length > 0 && ` · ${summary.excludedTitles.length} row(s) excluded (not real products)`}
          </p>
          <p className="text-stone-500">
            {Object.entries(summary.typeCounts)
              .map(([type, count]) => `${count} ${type}`)
              .join(" · ")}
          </p>
        </div>
      )}

      {mode !== "aliexpress" && phase !== "idle" && (
        <div className="mt-8">
          <div className="h-2 bg-stone-200 w-full">
            <div className="h-2 bg-ink-950 transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-xs text-stone-500 mt-2">
            {progress}% · {processedRows} new product{processedRows === 1 ? "" : "s"} added
            {skippedExisting > 0 ? ` · ${skippedExisting} already existed (left alone)` : ""}
            {markedOutOfStock !== undefined ? ` · ${markedOutOfStock} marked out of stock` : ""}
            {errors.length > 0 ? ` · ${errors.length} row error${errors.length === 1 ? "" : "s"}` : ""}
          </p>
        </div>
      )}

      {mode !== "aliexpress" && phase === "done" && <p className="text-sm mt-4">Import complete.</p>}
      {mode !== "aliexpress" && phase === "error" && <p className="text-sm text-red-600 mt-4">{message}</p>}

      {errors.length > 0 && (
        <div className="mt-6 border border-stone-200 max-h-64 overflow-y-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-stone-500 border-b border-stone-200">
                <th className="p-2">Row</th>
                <th className="p-2">Handle</th>
                <th className="p-2">Error</th>
              </tr>
            </thead>
            <tbody>
              {errors.map((e, i) => (
                <tr key={i} className="border-b border-stone-100">
                  <td className="p-2">{e.rowNumber >= 0 ? e.rowNumber : "—"}</td>
                  <td className="p-2">{e.handle ?? "—"}</td>
                  <td className="p-2">{e.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
