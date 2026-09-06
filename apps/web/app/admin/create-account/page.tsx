"use client";

import { useState, type FormEvent } from "react";

export default function CreateAccountPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/admin/create-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not create the account");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the account");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="container-page py-20 max-w-md">
        <h1 className="font-serif text-2xl mb-4">Account created</h1>
        <p className="text-sm text-stone-600 mb-6">
          Your admin account is ready. From now on, sign in at{" "}
          <a href="/admin/login" className="underline">
            /admin/login
          </a>{" "}
          with this email and password — the shared admin password no longer works for this store.
        </p>
        <a href="/admin/login" className="btn-primary inline-block">
          Go to sign in
        </a>
      </div>
    );
  }

  return (
    <div className="container-page py-20 max-w-md">
      <h1 className="font-serif text-2xl mb-2">Create your admin account</h1>
      <p className="text-sm text-stone-600 mb-6">
        This store doesn&rsquo;t have a real admin account yet — you got here using the shared admin password. Set an
        email and password now to sign in going forward; the shared password stops working for this store as soon as
        you do.
      </p>
      <form onSubmit={handleSubmit} className="card p-6">
        <label className="block mb-4">
          <span className="block text-sm font-medium mb-1">Email</span>
          <input
            type="email"
            required
            autoComplete="username"
            className="w-full border border-stone-300 px-3 py-2 text-sm"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="block mb-4">
          <span className="block text-sm font-medium mb-1">Password</span>
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="w-full border border-stone-300 px-3 py-2 text-sm"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label className="block mb-4">
          <span className="block text-sm font-medium mb-1">Confirm password</span>
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="w-full border border-stone-300 px-3 py-2 text-sm"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </label>
        {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
        <button type="submit" className="btn-primary w-full" disabled={loading}>
          {loading ? "Creating…" : "Create account"}
        </button>
      </form>
    </div>
  );
}
