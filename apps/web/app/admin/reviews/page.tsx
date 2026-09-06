import Link from "next/link";
import { getPendingReviews } from "@/lib/data/reviews";
import PendingReviewActions from "@/components/admin/PendingReviewActions";

export const dynamic = "force-dynamic";

function Stars({ rating }: { rating: number }) {
  return (
    <span className="text-amber-500">
      {"★".repeat(rating)}
      <span className="text-stone-300">{"★".repeat(5 - rating)}</span>
    </span>
  );
}

export default async function AdminReviewsPage() {
  const pending = await getPendingReviews();

  return (
    <div>
      <h1 className="font-serif text-3xl mb-2">Reviews</h1>
      <p className="text-sm text-stone-600 mb-8">
        Every submitted review starts hidden until approved here — nothing a customer writes appears on a product page
        without moderation first.
      </p>

      {pending.length === 0 ? (
        <div className="border border-stone-200 p-8 text-center">
          <p className="text-sm text-stone-600">No reviews awaiting moderation.</p>
        </div>
      ) : (
        <ul className="space-y-4">
          {pending.map((review) => (
            <li key={review.id} className="card p-5">
              <div className="flex items-start justify-between gap-4 mb-2">
                <div>
                  <Link href={`/product/${review.productHandle}`} className="text-sm font-medium underline" target="_blank">
                    {review.productTitle}
                  </Link>
                  <div className="flex items-center gap-2 mt-1">
                    <Stars rating={review.rating} />
                    {review.title && <span className="text-sm font-medium">{review.title}</span>}
                  </div>
                </div>
                <span className="text-xs text-stone-400 whitespace-nowrap">{new Date(review.createdAt).toLocaleString()}</span>
              </div>
              {review.body && <p className="text-sm text-stone-600 leading-relaxed mb-2">{review.body}</p>}
              <p className="text-xs text-stone-400 mb-3">
                {review.reviewerName ?? "Anonymous"} {review.reviewerEmail && `· ${review.reviewerEmail}`}
              </p>
              <PendingReviewActions reviewId={review.id} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
