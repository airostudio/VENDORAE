"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function PendingReviewActions({ reviewId }: { reviewId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "approve" | "reject") {
    setPending(action);
    setError(null);
    try {
      const res = await fetch(`/api/admin/reviews/${reviewId}`, { method: action === "approve" ? "PATCH" : "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Could not update the review");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the review");
      setPending(null);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button className="btn-secondary text-xs px-3 py-1.5" disabled={pending !== null} onClick={() => act("approve")}>
        {pending === "approve" ? "Approving…" : "Approve"}
      </button>
      <button className="text-xs px-3 py-1.5 text-red-600 border border-red-200 hover:bg-red-50" disabled={pending !== null} onClick={() => act("reject")}>
        {pending === "reject" ? "Rejecting…" : "Reject"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
