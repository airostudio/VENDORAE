import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getGuideBySlug } from "@/lib/data/guides";

export const dynamic = "force-dynamic";

interface Props {
  params: { slug: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const guide = await getGuideBySlug(params.slug);
  return guide ? { title: guide.title, description: guide.excerpt } : {};
}

export default async function GuideDetailPage({ params }: Props) {
  const guide = await getGuideBySlug(params.slug);
  if (!guide) notFound();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: guide.title,
    articleSection: guide.category,
  };

  return (
    <div className="container-page py-14 max-w-2xl">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <p className="eyebrow mb-3">{guide.category}</p>
      <h1 className="font-serif text-4xl mb-6">{guide.title}</h1>
      <div className="text-stone-600 leading-relaxed whitespace-pre-wrap">{guide.content}</div>
    </div>
  );
}
