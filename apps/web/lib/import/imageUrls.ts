/**
 * Reading the image column of an import row.
 *
 * A product with a broken image link is still a product worth importing, so nothing here throws:
 * anything unusable is dropped and reported, and the row goes in with whatever images survived.
 */

/** Kept small on purpose: each one is a network fetch inside a chunk's time budget when re-hosting. */
export const MAX_IMAGES_PER_PRODUCT = 4;

export interface ParsedImageUrls {
  urls: string[];
  /** Values that were present but unusable, with why — surfaced to the admin, never silently dropped. */
  rejected: { value: string; reason: string }[];
}

/**
 * Splits an image cell into usable absolute URLs.
 *
 * Only http(s) is accepted: a `file:///` path, a Windows share, a bare filename or an Excel error
 * string like #N/A can all appear in a real export, and none of them can ever load in a customer's
 * browser. Storing them would put a permanently broken image on the storefront.
 */
export function parseImageUrls(cell: string | undefined | null): ParsedImageUrls {
  const urls: string[] = [];
  const rejected: { value: string; reason: string }[] = [];
  if (!cell || !cell.trim()) return { urls, rejected };

  for (const raw of cell.split(/[|,]/)) {
    const value = raw.trim();
    if (!value) continue;
    if (urls.length >= MAX_IMAGES_PER_PRODUCT) {
      rejected.push({ value, reason: `only the first ${MAX_IMAGES_PER_PRODUCT} images per product are imported` });
      continue;
    }

    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      rejected.push({ value, reason: "not a full URL" });
      continue;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      rejected.push({ value, reason: `${parsed.protocol.replace(":", "")} links can't be loaded by a browser` });
      continue;
    }
    if (urls.includes(parsed.toString())) continue;
    urls.push(parsed.toString());
  }

  return { urls, rejected };
}

/**
 * Whether the storefront can actually display this URL.
 *
 * Only https qualifies. next.config.mjs's remotePatterns allow https alone, so anything else is
 * rejected by the image optimizer with INVALID_IMAGE_OPTIMIZE_REQUEST — and even if it were
 * allowed, a browser blocks http subresources on an https page as mixed content. An http image
 * therefore cannot be shown, however correct the URL is; it has to be copied into our own storage
 * first. Widening remotePatterns would not fix it.
 */
export function isDisplayableImageUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

/** A stable storage path for a source image, so re-importing the same file doesn't pile up copies. */
export function storagePathForImage(tenantId: string, sourceUrl: string): string {
  // Non-cryptographic; this only needs to be stable and collision-resistant enough for filenames.
  let hash = 0;
  for (let i = 0; i < sourceUrl.length; i++) {
    hash = (hash * 31 + sourceUrl.charCodeAt(i)) | 0;
  }
  const name = Math.abs(hash).toString(36);
  const extension = extensionFor(sourceUrl);
  return `${tenantId}/imported/${name}${extension}`;
}

function extensionFor(sourceUrl: string): string {
  const match = /\.(jpe?g|png|webp|gif|avif)(?:$|\?)/i.exec(sourceUrl);
  return match ? `.${match[1].toLowerCase()}` : ".jpg";
}
