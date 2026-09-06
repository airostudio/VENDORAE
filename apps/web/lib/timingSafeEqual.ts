/**
 * Constant-time string comparison for the edge runtime (no `node:crypto` there, so no
 * `timingSafeEqual`). Hashes both inputs to a fixed-length digest first so the comparison also
 * doesn't leak the input's length, then compares every byte of the digest without
 * short-circuiting.
 */
export async function timingSafeStringEqual(a: string, b: string): Promise<boolean> {
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  const [digestA, digestB] = await Promise.all([digest(a), digest(b)]);
  let diff = 0;
  for (let i = 0; i < digestA.length; i++) {
    diff |= digestA[i] ^ digestB[i];
  }
  return diff === 0;
}
