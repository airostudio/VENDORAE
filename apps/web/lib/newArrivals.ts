/**
 * Every product joins New Arrivals when it's created, and leaves after five days.
 *
 * The leaving is derived from the product's own created_at rather than waited out by a timer:
 * this store has no scheduler (apps/worker is a scaffold), and a listing that depends on a job
 * having run is a listing that goes wrong the first time the job doesn't. Reading the cutoff makes
 * the storefront correct at the instant a product turns five days old, with nothing to run.
 *
 * `sweepNewArrivals` then deletes the expired links as housekeeping, so the stored categories
 * eventually match what's displayed — but nothing depends on it having happened.
 */
export const NEW_ARRIVALS_HANDLE = "new-arrivals";
export const NEW_ARRIVALS_DAYS = 5;

/** Products created before this are no longer new. */
export function newArrivalsCutoffIso(now: Date = new Date()): string {
  return new Date(now.getTime() - NEW_ARRIVALS_DAYS * 24 * 60 * 60 * 1000).toISOString();
}
