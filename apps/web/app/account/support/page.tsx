"use client";

import { useState } from "react";

const categories = ["Order", "Product", "Warranty", "Return", "Delivery", "Other"];

export default function SupportPage() {
  const [submitted, setSubmitted] = useState(false);

  return (
    <div className="max-w-lg">
      <p className="text-sm text-stone-500 mb-6">
        Use your order reference where possible — we only ask for what's needed to help, never unnecessary personal detail.
      </p>
      {submitted ? (
        <p className="text-sm">Thanks — we've received your message and will reply by email shortly.</p>
      ) : (
        <form className="space-y-4 text-sm" onSubmit={(e) => { e.preventDefault(); setSubmitted(true); }}>
          <div>
            <label className="block mb-1">Order reference (optional)</label>
            <input className="w-full border border-stone-300 px-3 py-2" placeholder="ORD-10231" />
          </div>
          <div>
            <label className="block mb-1">Category</label>
            <select className="w-full border border-stone-300 px-3 py-2">
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block mb-1">Message</label>
            <textarea rows={5} className="w-full border border-stone-300 px-3 py-2" />
          </div>
          <button type="submit" className="btn-primary">
            Send Message
          </button>
        </form>
      )}
    </div>
  );
}
