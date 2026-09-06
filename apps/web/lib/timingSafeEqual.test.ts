import { describe, expect, it } from "vitest";
import { timingSafeStringEqual } from "./timingSafeEqual";

describe("timingSafeStringEqual", () => {
  it("returns true for identical strings", async () => {
    expect(await timingSafeStringEqual("hunter2", "hunter2")).toBe(true);
  });

  it("returns false for different strings of the same length", async () => {
    expect(await timingSafeStringEqual("hunter2", "hunter3")).toBe(false);
  });

  it("returns false for different-length strings", async () => {
    expect(await timingSafeStringEqual("short", "a-lot-longer-string")).toBe(false);
  });

  it("returns true for two empty strings", async () => {
    expect(await timingSafeStringEqual("", "")).toBe(true);
  });
});
