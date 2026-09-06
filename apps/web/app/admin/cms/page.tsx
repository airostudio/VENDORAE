import BannerManager from "@/components/admin/BannerManager";
import { getGuides } from "@/lib/data/guides";

export const dynamic = "force-dynamic";

export default async function AdminCmsPage() {
  const guides = await getGuides();
  return (
    <div className="max-w-4xl space-y-10">
      <div>
        <h1 className="font-serif text-3xl mb-6">CMS &amp; Banners</h1>
        <BannerManager />
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
