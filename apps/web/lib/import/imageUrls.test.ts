import { describe, expect, it } from "vitest";
import { MAX_IMAGES_PER_PRODUCT, isDisplayableImageUrl, parseImageUrls, storagePathForImage } from "./imageUrls";

describe("parseImageUrls", () => {
  it("returns nothing for a missing or empty cell", () => {
    expect(parseImageUrls(undefined)).toEqual({ urls: [], rejected: [] });
    expect(parseImageUrls("   ")).toEqual({ urls: [], rejected: [] });
  });

  it("splits on both pipes and commas and trims", () => {
    const { urls } = parseImageUrls(" https://a.test/1.jpg | https://a.test/2.jpg , https://a.test/3.jpg ");
    expect(urls).toEqual(["https://a.test/1.jpg", "https://a.test/2.jpg", "https://a.test/3.jpg"]);
  });

  it("rejects values that aren't full URLs, with a reason", () => {
    const { urls, rejected } = parseImageUrls("product1.jpg");
    expect(urls).toEqual([]);
    expect(rejected).toEqual([{ value: "product1.jpg", reason: "not a full URL" }]);
  });

  it("rejects schemes a browser can't load", () => {
    const { urls, rejected } = parseImageUrls("file:///C:/images/a.jpg");
    expect(urls).toEqual([]);
    expect(rejected[0].reason).toMatch(/can't be loaded by a browser/);
  });

  it("keeps plain http, which is re-hosted rather than dropped", () => {
    // The storefront's image loader won't render http, but the bytes are still fetchable —
    // dropping these would lose images that copying into our own bucket recovers.
    expect(parseImageUrls("http://windsoraws.dyndns.info/web_images/a.jpg").urls).toEqual([
      "http://windsoraws.dyndns.info/web_images/a.jpg",
    ]);
  });

  it("reports a spreadsheet error string rather than storing it as an image", () => {
    const { urls, rejected } = parseImageUrls("#N/A");
    expect(urls).toEqual([]);
    expect(rejected).toHaveLength(1);
  });

  it("keeps good URLs from a cell that also contains a bad one", () => {
    const { urls, rejected } = parseImageUrls("https://a.test/ok.jpg|not-a-url");
    expect(urls).toEqual(["https://a.test/ok.jpg"]);
    expect(rejected).toHaveLength(1);
  });

  it("de-duplicates repeated URLs", () => {
    expect(parseImageUrls("https://a.test/1.jpg|https://a.test/1.jpg").urls).toEqual(["https://a.test/1.jpg"]);
  });

  it("caps how many images one product can bring in, reporting the rest", () => {
    const cell = Array.from({ length: MAX_IMAGES_PER_PRODUCT + 2 }, (_, i) => `https://a.test/${i}.jpg`).join("|");
    const { urls, rejected } = parseImageUrls(cell);
    expect(urls).toHaveLength(MAX_IMAGES_PER_PRODUCT);
    expect(rejected).toHaveLength(2);
  });
});

describe("storagePathForImage", () => {
  it("is stable for the same source, so re-importing doesn't pile up copies", () => {
    const a = storagePathForImage("tenant-1", "https://a.test/photo.png");
    const b = storagePathForImage("tenant-1", "https://a.test/photo.png");
    expect(a).toBe(b);
  });

  it("separates tenants and keeps the original extension", () => {
    expect(storagePathForImage("tenant-1", "https://a.test/photo.png")).toMatch(/^tenant-1\/imported\/.+\.png$/);
    expect(storagePathForImage("tenant-2", "https://a.test/photo.png")).toMatch(/^tenant-2\/imported\//);
  });

  it("falls back to .jpg when the URL doesn't name a type", () => {
    expect(storagePathForImage("t", "https://a.test/image?id=12")).toMatch(/\.jpg$/);
  });

  it("gives different sources different paths", () => {
    expect(storagePathForImage("t", "https://a.test/1.jpg")).not.toBe(storagePathForImage("t", "https://a.test/2.jpg"));
  });
});

describe("isDisplayableImageUrl", () => {
  it("accepts https, which is all remotePatterns allows", () => {
    expect(isDisplayableImageUrl("https://a.test/photo.jpg")).toBe(true);
  });

  it("rejects http — the case behind INVALID_IMAGE_OPTIMIZE_REQUEST", () => {
    // Correct, reachable, and still undisplayable: the optimizer refuses it, and a browser would
    // block it as mixed content on an https page even if the optimizer didn't.
    expect(isDisplayableImageUrl("http://windsoraws.dyndns.info/web_images/a.jpg")).toBe(false);
  });

  it("rejects anything that isn't a URL at all", () => {
    expect(isDisplayableImageUrl("")).toBe(false);
    expect(isDisplayableImageUrl("product1.jpg")).toBe(false);
  });
});
