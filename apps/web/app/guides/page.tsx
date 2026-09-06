import type { Metadata } from "next";
import Link from "next/link";
import { getGuides } from "@/lib/data/guides";

export const metadata: Metadata = { title: "Guides", description: "Style, care and material guides from Beach Footprints." };
export const dynamic = "force-dynamic";

export default async function GuidesPage() {
  const guides = await getGuides();
  return (
    <div className="container-page py-14">
      <h1 className="font-serif text-4xl mb-10">Guides</h1>
      <div className="grid sm:grid-cols-2 gap-8">
        {guides.map((g) => (
          <Link key={g.slug} href={`/guides/${g.slug}`} className="border border-stone-200 p-6 hover:border-ink-500 block">
            <p className="eyebrow mb-2">{g.category}</p>
            <h2 className="font-serif text-xl mb-2">{g.title}</h2>
            <p className="text-sm text-stone-500">{g.excerpt}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
