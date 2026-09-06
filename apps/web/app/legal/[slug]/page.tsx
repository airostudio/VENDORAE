import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { POLICIES, getPolicy } from "@/lib/legal/policies";
import { getStoreSettings } from "@/lib/data/settings";

// The policy text is static, but the contact block reads the store's settings, so these render
// per request like every other database-backed page here rather than at build time.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const policy = getPolicy(params.slug);
  if (!policy) return {};
  return { title: policy.title, description: policy.summary };
}

export default async function LegalPage({ params }: { params: { slug: string } }) {
  const policy = getPolicy(params.slug);
  if (!policy) notFound();

  // Contact details come from the store's own settings rather than being written into the policy
  // text, so they stay correct when they change and nothing here invents an address.
  const settings = await getStoreSettings();

  return (
    <div className="container-page py-16 max-w-3xl">
      <nav className="text-xs text-stone-500 mb-8 flex gap-2">
        <Link href="/">Home</Link>
        <span>/</span>
        <span className="text-ink-900">{policy.title}</span>
      </nav>

      <h1 className="font-serif text-4xl mb-3">{policy.title}</h1>
      <p className="text-stone-600 leading-relaxed mb-2">{policy.summary}</p>
      <p className="text-xs text-stone-400 mb-12">Last updated {policy.updated}</p>

      <div className="space-y-10">
        {policy.sections.map((section) => (
          <section key={section.heading}>
            <h2 className="font-serif text-xl mb-3">{section.heading}</h2>
            {section.paragraphs?.map((paragraph, i) => (
              <p key={i} className="text-sm text-stone-600 leading-relaxed mb-3">
                {paragraph}
              </p>
            ))}
            {section.list && (
              <ul className="text-sm text-stone-600 leading-relaxed list-disc pl-5 space-y-1 mb-3">
                {section.list.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
          </section>
        ))}

        <section className="border-t border-stone-200 pt-8">
          <h2 className="font-serif text-xl mb-3">Contact us</h2>
          <p className="text-sm text-stone-600 leading-relaxed">
            {settings.contactEmail ? (
              <>
                Email us at{" "}
                <a href={`mailto:${settings.contactEmail}`} className="underline">
                  {settings.contactEmail}
                </a>
                {settings.contactPhone && <> or call {settings.contactPhone}</>}.
              </>
            ) : (
              <>
                Reach us through the{" "}
                <Link href="/account/support" className="underline">
                  support page
                </Link>
                .
              </>
            )}
            {settings.contactAddress && <> Our postal address is {settings.contactAddress}.</>}
          </p>
        </section>

        <nav className="border-t border-stone-200 pt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {POLICIES.filter((p) => p.slug !== policy.slug).map((other) => (
            <Link key={other.slug} href={`/legal/${other.slug}`} className="underline text-stone-600">
              {other.title}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
