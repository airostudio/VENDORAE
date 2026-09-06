import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { storagePathForImage } from "./imageUrls";

export interface ImageFetchCredentials {
  username: string;
  password: string;
}

export interface RehostOptions {
  credentials?: ImageFetchCredentials | null;
  /** Stop fetching once past this. The chunk still returns its rows; whatever wasn't fetched is reported. */
  deadline: number;
}

export interface RehostOutcome {
  /** Source URL -> the public storage URL it now lives at. */
  rehosted: Map<string, string>;
  failures: { url: string; reason: string }[];
}

const BUCKET = "product-images";
const FETCH_TIMEOUT_MS = 10_000;
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Downloads source images and re-hosts them in this store's own public bucket.
 *
 * Needed whenever the source isn't something a customer's browser can load directly — a host
 * behind a login (the browser has no way to authenticate for them), or plain http, which the
 * storefront's image loader won't render. Storing the original URL in those cases produces a
 * catalogue of broken images, so the bytes are copied once at import time instead.
 *
 * Every failure is contained: an image that 404s, needs a login it wasn't given, times out, or
 * isn't actually an image is reported and skipped. The product still imports.
 */
export async function rehostImages(
  supabase: SupabaseClient,
  tenantId: string,
  urls: string[],
  options: RehostOptions,
): Promise<RehostOutcome> {
  const rehosted = new Map<string, string>();
  const failures: { url: string; reason: string }[] = [];
  if (urls.length === 0) return { rehosted, failures };

  const authHeader = options.credentials
    ? `Basic ${Buffer.from(`${options.credentials.username}:${options.credentials.password}`).toString("base64")}`
    : undefined;

  for (const url of urls) {
    if (Date.now() > options.deadline) {
      failures.push({ url, reason: "ran out of time in this batch — re-run the import to pick it up" });
      continue;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(url, {
          signal: controller.signal,
          headers: authHeader ? { Authorization: authHeader } : undefined,
          redirect: "follow",
        });
      } finally {
        clearTimeout(timeout);
      }

      if (response.status === 401 || response.status === 403) {
        failures.push({
          url,
          reason: authHeader ? "the login was rejected by the image host" : "needs a login — enter one in the import screen",
        });
        continue;
      }
      if (!response.ok) {
        failures.push({ url, reason: `image host returned ${response.status}` });
        continue;
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.startsWith("image/")) {
        // A login page served with 200 is the classic case: fetching "succeeds" and returns HTML,
        // which would otherwise be stored as if it were a product photo.
        failures.push({ url, reason: `not an image (server sent ${contentType || "no content type"})` });
        continue;
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength === 0) {
        failures.push({ url, reason: "image was empty" });
        continue;
      }
      if (bytes.byteLength > MAX_BYTES) {
        failures.push({ url, reason: `image is larger than ${MAX_BYTES / (1024 * 1024)}MB` });
        continue;
      }

      const path = storagePathForImage(tenantId, url);
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, bytes, {
        contentType,
        upsert: true,
      });
      if (uploadError) {
        failures.push({ url, reason: `could not store the image: ${uploadError.message}` });
        continue;
      }

      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
      if (!data?.publicUrl) {
        failures.push({ url, reason: "stored the image but could not resolve its public URL" });
        continue;
      }
      rehosted.set(url, data.publicUrl);
    } catch (error) {
      const reason = error instanceof Error && error.name === "AbortError" ? "image host timed out" : "could not reach the image host";
      failures.push({ url, reason });
    }
  }

  return { rehosted, failures };
}
