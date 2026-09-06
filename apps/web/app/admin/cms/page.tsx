import { getHeroBanner } from "@/lib/data/cms";
import { getGuides } from "@/lib/data/guides";

export const dynamic = "force-dynamic";

export default async function AdminCmsPage() {
  const [heroBanner, guides] = await Promise.all([getHeroBanner(), getGuides()]);
  return (
    <div className="space-y-10">
      <div>
        <h1 className="font-serif text-3xl mb-6">CMS &amp; Banners</h1>
        <div className="border border-stone-200 p-4">
          <p className="text-sm font-medium mb-2">Homepage Hero</p>
          <p className="text-xs text-stone-500">Headline: {heroBanner.headline}</p>
          <p className="text-xs text-stone-500">Body: {heroBanner.body}</p>
          <button className="btn-secondary mt-4">Edit Hero</button>
        </div>
      </div>
      <div>
        <p className="text-sm font-medium mb-3">Guides</p>
        <div className="space-y-2">
          {guides.map((g) => (
            <div key={g.slug} className="border border-stone-200 p-3 flex justify-between text-sm">
              <span>{g.title}</span>
              <button className="text-xs underline">Edit</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
