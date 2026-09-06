"use client";

import { useState } from "react";
import type { ProductReview } from "@/lib/data/reviews";

function Stars({ rating }: { rating: number }) {
  return (
    <span aria-label={`${rating} out of 5 stars`} className="text-amber-500">
      {"★".repeat(rating)}
      <span className="text-stone-300">{"★".repeat(5 - rating)}</span>
    </span>
  );
}

export default function ProductReviews({ productId, reviews }: { productId: string; reviews: ProductReview[] }) {
  const [showForm, setShowForm] = useState(false);
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "submitted" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    setError(null);
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, rating, title: title || undefined, body: body || undefined, name, email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Could not submit your review");
      setStatus("submitted");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit your review");
      setStatus("error");
    }
  }

  return (
    <section className="mt-16 border-t border-stone-200 pt-10">
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-serif text-2xl">Reviews {reviews.length > 0 && `(${reviews.length})`}</h2>
        {!showForm && status !== "submitted" && (
          <button className="btn-secondary" onClick={() => setShowForm(true)}>
            Write a Review
          </button>
        )}
      </div>

      {status === "submitted" ? (
        <p className="text-sm text-green-700 border border-green-700 bg-green-50 px-4 py-3 mb-8">
          Thanks for your review! It&rsquo;s awaiting approval and will appear here once it&rsquo;s been checked.
        </p>
      ) : (
        showForm && (
          <form onSubmit={submit} className="border border-stone-200 p-6 mb-10 max-w-xl space-y-4">
            <div>
              <span className="block text-xs text-stone-500 mb-1">Rating</span>
              <div className="flex gap-1 text-2xl">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setRating(n)}
                    aria-label={`${n} star${n === 1 ? "" : "s"}`}
                    className={n <= rating ? "text-amber-500" : "text-stone-300"}
                  >
                    ★
                  </button>
                ))}
              </div>
            </div>

            <label className="block text-sm">
              <span className="block text-xs text-stone-500 mb-1">Your name</span>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full border border-stone-300 px-3 py-2 text-sm"
              />
            </label>

            <label className="block text-sm">
              <span className="block text-xs text-stone-500 mb-1">Email (not shown publicly)</span>
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border border-stone-300 px-3 py-2 text-sm"
              />
            </label>

            <label className="block text-sm">
              <span className="block text-xs text-stone-500 mb-1">Title (optional)</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} className="w-full border border-stone-300 px-3 py-2 text-sm" />
            </label>

            <label className="block text-sm">
              <span className="block text-xs text-stone-500 mb-1">Review (optional)</span>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={2000}
                rows={4}
                className="w-full border border-stone-300 px-3 py-2 text-sm"
              />
            </label>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex gap-3">
              <button type="submit" disabled={status === "submitting"} className="btn-primary">
                {status === "submitting" ? "Submitting…" : "Submit Review"}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>
                Cancel
              </button>
            </div>
          </form>
        )
      )}

      {reviews.length === 0 ? (
        <p className="text-sm text-stone-500">No reviews yet — be the first to write one.</p>
      ) : (
        <ul className="space-y-6 max-w-2xl">
          {reviews.map((review) => (
            <li key={review.id} className="border-b border-stone-100 pb-6">
              <div className="flex items-center gap-3 mb-1">
                <Stars rating={review.rating} />
                {review.title && <span className="text-sm font-medium">{review.title}</span>}
              </div>
              {review.body && <p className="text-sm text-stone-600 leading-relaxed mb-1">{review.body}</p>}
              <p className="text-xs text-stone-400">
                {review.reviewerName ?? "Anonymous"} · {new Date(review.createdAt).toLocaleDateString()}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
