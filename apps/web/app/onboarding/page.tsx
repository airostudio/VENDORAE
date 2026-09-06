"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Step = "welcome" | "business" | "logo" | "stripe" | "paypal" | "review";

const STEPS: Step[] = ["welcome", "business", "logo", "stripe", "paypal", "review"];
const STEP_LABELS: Record<Step, string> = {
  welcome: "Welcome",
  business: "Business",
  logo: "Logo",
  stripe: "Stripe",
  paypal: "PayPal",
  review: "Review",
};

interface OnboardingState {
  onboardingCompleted: boolean;
  businessName: string;
  businessDescription: string;
  productNiche: string;
  logoUrl: string | null;
  stripe: { secretKeyConfigured: boolean; publishableKeyConfigured: boolean; webhookSecretConfigured: boolean };
  paypal: { clientIdConfigured: boolean; clientSecretConfigured: boolean; mode: "sandbox" | "live" };
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block mb-4">
      <span className="block text-sm font-medium mb-1">{label}</span>
      {children}
      {hint && <span className="block text-xs text-stone-500 mt-1">{hint}</span>}
    </label>
  );
}

const inputClass = "w-full border border-stone-300 px-3 py-2 text-sm";

export default function OnboardingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [stepIndex, setStepIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [businessName, setBusinessName] = useState("");
  const [businessDescription, setBusinessDescription] = useState("");
  const [productNiche, setProductNiche] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);

  const [stripeSecretKey, setStripeSecretKey] = useState("");
  const [stripePublishableKey, setStripePublishableKey] = useState("");
  const [stripeWebhookSecret, setStripeWebhookSecret] = useState("");
  const [stripeStatus, setStripeStatus] = useState<OnboardingState["stripe"] | null>(null);

  const [paypalClientId, setPaypalClientId] = useState("");
  const [paypalClientSecret, setPaypalClientSecret] = useState("");
  const [paypalMode, setPaypalMode] = useState<"sandbox" | "live">("sandbox");
  const [paypalStatus, setPaypalStatus] = useState<OnboardingState["paypal"] | null>(null);

  useEffect(() => {
    fetch("/api/onboarding")
      .then((res) => res.json())
      .then((data: OnboardingState & { error?: string }) => {
        if (data.error) throw new Error(data.error);
        setBusinessName(data.businessName ?? "");
        setBusinessDescription(data.businessDescription ?? "");
        setProductNiche(data.productNiche ?? "");
        setLogoUrl(data.logoUrl ?? null);
        setStripeStatus(data.stripe);
        setPaypalStatus(data.paypal);
        setPaypalMode(data.paypal?.mode ?? "sandbox");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load onboarding"))
      .finally(() => setLoading(false));
  }, []);

  const step = STEPS[stepIndex];

  async function uploadLogo(file: File) {
    setLogoBusy(true);
    setLogoError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/onboarding/logo", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not upload the logo");
      setLogoUrl(data.logoUrl);
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : "Could not upload the logo");
    } finally {
      setLogoBusy(false);
    }
  }

  async function generateLogo() {
    setLogoBusy(true);
    setLogoError(null);
    try {
      const res = await fetch("/api/onboarding/logo/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessName, businessDescription, productNiche }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not generate a logo");
      setLogoUrl(data.logoUrl);
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : "Could not generate a logo");
    } finally {
      setLogoBusy(false);
    }
  }

  async function finish() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName,
          businessDescription,
          productNiche,
          stripeSecretKey: stripeSecretKey || undefined,
          stripePublishableKey: stripePublishableKey || undefined,
          stripeWebhookSecret: stripeWebhookSecret || undefined,
          paypalClientId: paypalClientId || undefined,
          paypalClientSecret: paypalClientSecret || undefined,
          paypalMode,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save your store setup");
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your store setup");
    } finally {
      setSaving(false);
    }
  }

  function next() {
    if (step === "business" && !businessName.trim()) {
      setError("Enter a business name to continue.");
      return;
    }
    setError(null);
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  }
  function back() {
    setError(null);
    setStepIndex((i) => Math.max(i - 1, 0));
  }

  if (loading) return <div className="container-page py-20 text-sm text-stone-500">Loading setup wizard…</div>;

  return (
    <div className="container-page py-14 max-w-2xl">
      <p className="eyebrow mb-2">Setup Wizard</p>
      <h1 className="font-serif text-3xl mb-2">Let&rsquo;s set up your store</h1>
      <p className="text-sm text-stone-600 mb-8">
        A few steps before your storefront goes live. You can revisit payment settings any time from{" "}
        <span className="font-medium">Admin → Payments</span>.
      </p>

      <div className="flex gap-2 mb-10">
        {STEPS.map((s, i) => (
          <div key={s} className={`flex-1 h-1 ${i <= stepIndex ? "bg-ink-950" : "bg-stone-200"}`} title={STEP_LABELS[s]} />
        ))}
      </div>

      <div className="card p-6">
        {step === "welcome" && (
          <div>
            <h2 className="font-serif text-xl mb-3">Welcome</h2>
            <p className="text-sm text-stone-600 mb-2">
              This wizard collects your business info, a logo, and payment credentials so customers can browse and buy
              from a store that looks and feels like yours — not a demo.
            </p>
            <p className="text-sm text-stone-600">You can skip the payment steps for now and add them later from Admin → Payments.</p>
          </div>
        )}

        {step === "business" && (
          <div>
            <h2 className="font-serif text-xl mb-4">Business &amp; products</h2>
            <Field label="Business name" hint="Shown in your header, footer and page titles.">
              <input className={inputClass} value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Acme Co." />
            </Field>
            <Field label="Business description" hint="A sentence or two about what your store is.">
              <textarea
                className={inputClass}
                rows={3}
                value={businessDescription}
                onChange={(e) => setBusinessDescription(e.target.value)}
                placeholder="We sell hand-poured candles inspired by national parks."
              />
            </Field>
            <Field label="Product niche" hint="What kind of products do you want to sell?">
              <input
                className={inputClass}
                value={productNiche}
                onChange={(e) => setProductNiche(e.target.value)}
                placeholder="Home fragrance and candles"
              />
            </Field>
          </div>
        )}

        {step === "logo" && (
          <div>
            <h2 className="font-serif text-xl mb-4">Logo</h2>
            <p className="text-sm text-stone-600 mb-4">Upload an image, or generate one with AI. You can change this later.</p>
            {logoUrl && (
              <div className="mb-4 flex items-center gap-4">
                {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary remote/storage host */}
                <img src={logoUrl} alt="Your logo" className="h-16 w-16 object-contain border border-stone-200 bg-white" />
                <span className="text-xs text-stone-500">Current logo</span>
              </div>
            )}
            <div className="flex flex-wrap gap-3 mb-3">
              <label className="btn-secondary cursor-pointer">
                Upload image
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  className="hidden"
                  disabled={logoBusy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void uploadLogo(file);
                  }}
                />
              </label>
              <button type="button" className="btn-secondary" disabled={logoBusy || !businessName.trim()} onClick={() => void generateLogo()}>
                {logoBusy ? "Working…" : "AI Generate"}
              </button>
            </div>
            {!businessName.trim() && <p className="text-xs text-stone-500">Enter a business name first so AI Generate has something to work with.</p>}
            {logoError && <p className="text-sm text-red-600 mt-2">{logoError}</p>}
          </div>
        )}

        {step === "stripe" && (
          <div>
            <h2 className="font-serif text-xl mb-4">Stripe</h2>
            <p className="text-sm text-stone-600 mb-4">
              Used to accept card payments at checkout. Find these in your{" "}
              <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noreferrer" className="underline">
                Stripe dashboard
              </a>
              . Optional — you can add these later from Admin → Payments.
            </p>
            <Field label="Secret key" hint={stripeStatus?.secretKeyConfigured ? "Already configured — leave blank to keep it." : "sk_live_… or sk_test_…"}>
              <input className={inputClass} type="password" value={stripeSecretKey} onChange={(e) => setStripeSecretKey(e.target.value)} placeholder="sk_test_..." />
            </Field>
            <Field
              label="Publishable key"
              hint={stripeStatus?.publishableKeyConfigured ? "Already configured — leave blank to keep it." : "pk_live_… or pk_test_…"}
            >
              <input className={inputClass} value={stripePublishableKey} onChange={(e) => setStripePublishableKey(e.target.value)} placeholder="pk_test_..." />
            </Field>
            <Field
              label="Webhook signing secret"
              hint={stripeStatus?.webhookSecretConfigured ? "Already configured — leave blank to keep it." : "whsec_…"}
            >
              <input className={inputClass} type="password" value={stripeWebhookSecret} onChange={(e) => setStripeWebhookSecret(e.target.value)} placeholder="whsec_..." />
            </Field>
          </div>
        )}

        {step === "paypal" && (
          <div>
            <h2 className="font-serif text-xl mb-4">PayPal</h2>
            <p className="text-sm text-stone-600 mb-4">
              Optional. Find these in your{" "}
              <a href="https://developer.paypal.com/dashboard/applications" target="_blank" rel="noreferrer" className="underline">
                PayPal developer dashboard
              </a>
              .
            </p>
            <Field label="Mode">
              <select className={inputClass} value={paypalMode} onChange={(e) => setPaypalMode(e.target.value as "sandbox" | "live")}>
                <option value="sandbox">Sandbox (testing)</option>
                <option value="live">Live</option>
              </select>
            </Field>
            <Field label="Client ID" hint={paypalStatus?.clientIdConfigured ? "Already configured — leave blank to keep it." : undefined}>
              <input className={inputClass} value={paypalClientId} onChange={(e) => setPaypalClientId(e.target.value)} placeholder="AeA1QI..." />
            </Field>
            <Field label="Client secret" hint={paypalStatus?.clientSecretConfigured ? "Already configured — leave blank to keep it." : undefined}>
              <input className={inputClass} type="password" value={paypalClientSecret} onChange={(e) => setPaypalClientSecret(e.target.value)} placeholder="EL..." />
            </Field>
          </div>
        )}

        {step === "review" && (
          <div>
            <h2 className="font-serif text-xl mb-4">Review &amp; finish</h2>
            <dl className="text-sm space-y-2 mb-4">
              <div className="flex justify-between border-b border-stone-100 pb-2">
                <dt className="text-stone-500">Business name</dt>
                <dd>{businessName || "—"}</dd>
              </div>
              <div className="flex justify-between border-b border-stone-100 pb-2">
                <dt className="text-stone-500">Product niche</dt>
                <dd>{productNiche || "—"}</dd>
              </div>
              <div className="flex justify-between border-b border-stone-100 pb-2">
                <dt className="text-stone-500">Logo</dt>
                <dd>{logoUrl ? "Set" : "Not set"}</dd>
              </div>
              <div className="flex justify-between border-b border-stone-100 pb-2">
                <dt className="text-stone-500">Stripe</dt>
                <dd>{stripeSecretKey || stripeStatus?.secretKeyConfigured ? "Configured" : "Not set"}</dd>
              </div>
              <div className="flex justify-between pb-2">
                <dt className="text-stone-500">PayPal</dt>
                <dd>{paypalClientId || paypalStatus?.clientIdConfigured ? `Configured (${paypalMode})` : "Not set"}</dd>
              </div>
            </dl>
            <p className="text-xs text-stone-500">
              Finishing takes your store live at your storefront home page. You can change any of this later from Admin.
            </p>
          </div>
        )}

        {error && <p className="text-sm text-red-600 mt-4">{error}</p>}

        <div className="flex justify-between mt-8">
          <button type="button" className="btn-secondary" onClick={back} disabled={stepIndex === 0 || saving}>
            Back
          </button>
          {step === "review" ? (
            <button type="button" className="btn-primary" onClick={() => void finish()} disabled={saving}>
              {saving ? "Saving…" : "Finish setup"}
            </button>
          ) : (
            <button type="button" className="btn-primary" onClick={next} disabled={logoBusy}>
              Continue
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
