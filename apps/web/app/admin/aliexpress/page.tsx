"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * AliExpress connection, proxied through the dropship-engine (see the engine's
 * README). The engine has its own platform AliExpress app, so connecting is
 * just "log into your own AliExpress account" — the engine stores and refreshes
 * the resulting tokens itself, nothing secret ever lands in this browser.
 */
export default function AliExpressAuthPage() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [connectedAt, setConnectedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"connect" | "advanced" | "webhook" | null>(null);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [appKey, setAppKey] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [advancedSaved, setAdvancedSaved] = useState(false);

  useEffect(() => {
    fetch("/api/admin/aliexpress/auth")
      .then((res) => res.json())
      .then((data) => {
        if (typeof data.connected === "boolean") {
          setConnected(data.connected);
          setConnectedAt(data.connectedAt ?? null);
        }
      })
      .catch(() => setConnected(null));
  }, []);

  async function connect() {
    setError(null);
    setBusy("connect");
    try {
      const redirectUri = `${window.location.origin}/admin/aliexpress/callback`;
      const res = await fetch(`/api/admin/aliexpress/auth?redirectUri=${encodeURIComponent(redirectUri)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not start AliExpress connection");
      window.location.href = data.authorizeUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start AliExpress connection");
      setBusy(null);
    }
  }

  async function saveAdvancedApp() {
    setError(null);
    if (!appKey || !appSecret) {
      setError("Enter both the app key and app secret first.");
      return;
    }
    setBusy("advanced");
    try {
      const res = await fetch("/api/admin/aliexpress/auth", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appKey, appSecret }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save app credentials");
      setAdvancedSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save app credentials");
    } finally {
      setBusy(null);
    }
  }

  async function registerWebhook() {
    setError(null);
    setWebhookUrl(null);
    setBusy("webhook");
    try {
      const res = await fetch("/api/admin/aliexpress/webhook", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not register webhook");
      setWebhookUrl(data.webhookUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not register webhook");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="max-w-2xl">
      <p className="eyebrow mb-2">AliExpress</p>
      <h1 className="font-serif text-3xl mb-2">Connect AliExpress account</h1>
      <p className="text-sm text-stone-600 mb-8">
        Log in with your own AliExpress account to enable product import and order fulfillment. Nothing about your
        AliExpress account ever lands in this app — the dropshipping engine holds and refreshes the tokens itself.
      </p>

      <div className="card p-6 mb-6">
        {connected === true && (
          <>
            <p className="text-sm font-medium mb-1">Connected</p>
            {connectedAt && <p className="text-xs text-stone-500 mb-4">Since {new Date(connectedAt).toLocaleString()}</p>}
            <div className="flex gap-3 items-center">
              <button className="btn-secondary" onClick={connect} disabled={busy !== null}>
                {busy === "connect" ? "Redirecting…" : "Reconnect / switch account"}
              </button>
              <Link href="/admin/aliexpress/settings" className="text-sm underline">
                Pricing, stock &amp; notification settings
              </Link>
            </div>
          </>
        )}
        {connected === false && (
          <button className="btn-primary" onClick={connect} disabled={busy !== null}>
            {busy === "connect" ? "Redirecting…" : "Connect AliExpress"}
          </button>
        )}
        {connected === null && <p className="text-sm text-stone-500">Checking connection status…</p>}
      </div>

      {error && <p className="text-sm text-red-600 mb-6">{error}</p>}

      <div className="card p-6 mb-6">
        <div className="mb-2 text-sm font-medium">Webhook — receive price/stock/tracking updates</div>
        <p className="text-xs text-stone-500 mb-3">
          Requires <code>DROPSHIP_ENGINE_WEBHOOK_SECRET</code> already set as an env var on this deployment (it has to
          match what <code>/api/webhooks/dropship-engine</code> verifies signatures with).
        </p>
        <button className="btn-secondary" onClick={registerWebhook} disabled={busy !== null}>
          {busy === "webhook" ? "Registering…" : "Register webhook with the engine"}
        </button>
        {webhookUrl && <p className="text-sm mt-3">Registered: {webhookUrl}</p>}
      </div>

      <div className="card p-6">
        <button className="text-sm underline" onClick={() => setShowAdvanced((v) => !v)}>
          {showAdvanced ? "Hide advanced options" : "Advanced: use my own AliExpress app"}
        </button>
        {showAdvanced && (
          <div className="mt-4">
            <p className="text-xs text-stone-500 mb-3">
              Only needed if you registered your own app at open.aliexpress.com (e.g. for separate API rate limits)
              instead of using the engine&rsquo;s shared one.
            </p>
            <input
              type="text"
              value={appKey}
              onChange={(e) => setAppKey(e.target.value)}
              placeholder="App key"
              className="w-full border border-stone-300 px-3 py-2 text-sm mb-2"
            />
            <input
              type="password"
              value={appSecret}
              onChange={(e) => setAppSecret(e.target.value)}
              placeholder="App secret"
              className="w-full border border-stone-300 px-3 py-2 text-sm mb-4"
            />
            <button className="btn-secondary" onClick={saveAdvancedApp} disabled={busy !== null}>
              {busy === "advanced" ? "Saving…" : "Save app credentials"}
            </button>
            {advancedSaved && (
              <p className="text-sm mt-3">Saved — use the Connect button above to authorize with this app.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
