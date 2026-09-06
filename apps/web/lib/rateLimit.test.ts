import { describe, expect, it, vi, afterEach } from "vitest";
import { checkRateLimit, peekRateLimit, recordAttempt, clientIp } from "./rateLimit";

afterEach(() => {
  vi.useRealTimers();
});

describe("checkRateLimit", () => {
  it("allows requests up to the limit, then blocks", () => {
    const key = `test-${Math.random()}`;
    for (let i = 0; i < 3; i++) {
      expect(checkRateLimit(key, 3, 60).allowed).toBe(true);
    }
    const blocked = checkRateLimit(key, 3, 60);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("resets the count once the window elapses", () => {
    vi.useFakeTimers();
    const key = `test-${Math.random()}`;
    expect(checkRateLimit(key, 1, 10).allowed).toBe(true);
    expect(checkRateLimit(key, 1, 10).allowed).toBe(false);

    vi.advanceTimersByTime(10_001);

    expect(checkRateLimit(key, 1, 10).allowed).toBe(true);
  });

  it("tracks separate keys independently", () => {
    const keyA = `a-${Math.random()}`;
    const keyB = `b-${Math.random()}`;
    expect(checkRateLimit(keyA, 1, 60).allowed).toBe(true);
    expect(checkRateLimit(keyA, 1, 60).allowed).toBe(false);
    expect(checkRateLimit(keyB, 1, 60).allowed).toBe(true);
  });
});

describe("peekRateLimit / recordAttempt", () => {
  it("peek never consumes budget on its own", () => {
    const key = `peek-${Math.random()}`;
    for (let i = 0; i < 20; i++) {
      expect(peekRateLimit(key, 1).allowed).toBe(true);
    }
  });

  it("blocks once recordAttempt pushes past the limit", () => {
    const key = `record-${Math.random()}`;
    recordAttempt(key, 60);
    expect(peekRateLimit(key, 1).allowed).toBe(false);
  });
});

describe("clientIp", () => {
  it("takes the first entry of x-forwarded-for", () => {
    const request = new Request("https://example.com", { headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } });
    expect(clientIp(request)).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip, then unknown", () => {
    expect(clientIp(new Request("https://example.com", { headers: { "x-real-ip": "9.9.9.9" } }))).toBe("9.9.9.9");
    expect(clientIp(new Request("https://example.com"))).toBe("unknown");
  });
});
