"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * Where AliExpress redirects back to after the store owner logs in and approves
 * access. Picks the `code` out of the URL automatically and exchanges it via the
 * engine, so connecting an account is just "click Connect, log in" — no copying
 * a code out of the address bar.
 */
export default function AliExpressCallbackPage() {
  return (
    <Suspense fallback={null}>
      <AliExpressCallbackInner />
    </Suspense>
  );
}

function AliExpressCallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<"exchanging" | "done" | "error">("exchanging");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = searchParams.get("code");
    if (!code) {
      setStatus("error");
      setError("No code in the redirect — AliExpress may have denied access.");
      return;
    }

    const redirectUri = `${window.location.origin}/admin/aliexpress/callback`;
    fetch("/api/admin/aliexpress/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, redirectUri }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Token exchange failed");
        setStatus("done");
        setTimeout(() => router.replace("/admin/aliexpress/settings"), 1500);
      })
      .catch((err) => {
        setStatus("error");
        setError(err instanceof Error ? err.message : "Token exchange failed");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="max-w-2xl">
      <p className="eyebrow mb-2">AliExpress</p>
      <h1 className="font-serif text-3xl mb-6">Connecting…</h1>
      <div className="card p-6">
        {status === "exchanging" && <p className="text-sm text-stone-600">Finishing up with AliExpress…</p>}
        {status === "done" && <p className="text-sm font-medium">Connected. Taking you to your dropship settings…</p>}
        {status === "error" && (
          <>
            <p className="text-sm text-red-600 mb-3">{error}</p>
            <a href="/admin/aliexpress" className="underline text-sm">
              Back to AliExpress settings
            </a>
          </>
        )}
      </div>
    </div>
  );
}
