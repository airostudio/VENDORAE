/**
 * Best-effort, in-memory, per-instance rate limiting — a plain fixed-window counter keyed by
 * whatever key the caller passes (typically an IP). There is no shared store (no Redis/Upstash
 * configured for this deployment), so a request can land on a different serverless instance and
 * get a fresh window; this stops casual abuse and accidental retry storms, not a determined
 * attacker spread across instances. Upgrade to a shared store (e.g. Upstash) if that matters.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/** Counts this call as an attempt against the limit — use when every call (success or failure) consumes the budget. */
export function checkRateLimit(key: string, limit: number, windowSeconds: number): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (bucket.count >= limit) {
    return { allowed: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
  }

  bucket.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Read-only check, for gating an action on a limit without itself consuming budget — e.g. checking a lockout before verifying a password, where only a wrong password should count against it. */
export function peekRateLimit(key: string, limit: number): RateLimitResult {
  const bucket = buckets.get(key);
  const now = Date.now();
  if (!bucket || bucket.resetAt <= now) return { allowed: true, retryAfterSeconds: 0 };
  if (bucket.count >= limit) return { allowed: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Increments the counter for `key`, creating its window if absent. Pair with peekRateLimit to only count specific outcomes (e.g. failed login attempts). */
export function recordAttempt(key: string, windowSeconds: number): void {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return;
  }
  bucket.count += 1;
}

/** Best-effort client identity for rate limiting — trusts proxy-set headers, fine for abuse limiting (not authentication). */
export function clientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}
