import Link from "next/link";
import { getAllProductsForAdmin, getProductsWithoutMainCategory } from "@/lib/data/products";
import { getStoreCurrency } from "@/lib/data/settings";
import { getCategories } from "@/lib/data/categories";
import { NEW_ARRIVALS_HANDLE } from "@/lib/newArrivals";
import { countDemoProducts } from "@/lib/data/demoProducts";
import ProductsTable from "@/components/admin/ProductsTable";
import { publishAllDrafts, removeDemoProducts, setCatalogueCurrency, sweepNewArrivals } from "./actions";
import { NEW_ARRIVALS_DAYS } from "@/lib/newArrivals";

export const dynamic = "force-dynamic";

export default async function AdminProductsPage() {
  const [products, storeCurrency, demoCount, needMainCategory, allCategories] = await Promise.all([
    getAllProductsForAdmin(),
    getStoreCurrency(),
    countDemoProducts(),
    getProductsWithoutMainCategory(),
    getCategories(),
  ]);
  // New Arrivals isn't offered as a destination: every product joins it on creation and leaves it
  // after NEW_ARRIVALS_DAYS, so "moving" something there would be undone by the clock.
  const categoryNameByHandle = new Map(allCategories.map((c) => [c.handle, c.name]));
  const timesNamed = allCategories.reduce<Record<string, number>>((acc, c) => {
    acc[c.name] = (acc[c.name] ?? 0) + 1;
    return acc;
  }, {});
  const categoryChoices = allCategories
    .filter((c) => c.handle !== NEW_ARRIVALS_HANDLE)
    .map((c) => {
      const parent = c.parentHandle ? categoryNameByHandle.get(c.parentHandle) : undefined;
      const label = parent ? `${parent} / ${c.name}` : c.name;
      // Two categories can share a name (an import creating a second "Dolls", say), and then
      // picking one in a dropdown is a coin toss — and only one of them is the one the menu links
      // to. The URL handle is the thing that distinguishes them, so show it when it matters.
      return { id: c.id, name: timesNamed[c.name] > 1 ? `${label} (/${c.handle})` : label };
    });
  const draftCount = products.filter((p) => p.status === "DRAFT").length;

  // What the catalogue is actually priced in, against what the store is configured to sell in.
  // More than one value here means checkout will refuse to mix them in a cart, so it needs fixing
  // rather than just noting.
  const currencyCounts = products.reduce<Record<string, number>>((acc, p) => {
    if (p.priceCents > 0) acc[p.currency] = (acc[p.currency] ?? 0) + 1;
    return acc;
  }, {});
  const currencies = Object.entries(currencyCounts).sort((a, b) => b[1] - a[1]);
  const offCurrency = currencies.filter(([code]) => code !== storeCurrency).reduce((sum, [, count]) => sum + count, 0);
  const unpriced = products.filter((p) => p.priceCents === 0).length;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="font-serif text-3xl">Products</h1>
        <div className="flex gap-3">
          {draftCount > 0 && (
            <form action={publishAllDrafts}>
              <button type="submit" className="btn-secondary">
                Publish All Drafts ({draftCount})
              </button>
            </form>
          )}
          <form action={sweepNewArrivals}>
            <button type="submit" className="btn-secondary" title={`Clear New Arrivals for products older than ${NEW_ARRIVALS_DAYS} days`}>
              Tidy New Arrivals
            </button>
          </form>
          <Link href="/admin/products/import" className="btn-secondary">
            Import Products
          </Link>
          <button className="btn-primary">New Product</button>
        </div>
      </div>
      <div className="text-xs text-stone-500 mb-4 flex flex-wrap gap-x-4 gap-y-1">
        <span>{products.length} product{products.length === 1 ? "" : "s"}</span>
        <span>
          Selling in <span className="font-medium">{storeCurrency}</span>{" "}
          <Link href="/admin/payments" className="underline">
            change
          </Link>
        </span>
        <span>
          Priced in{" "}
          {currencies.length === 0 ? (
            <span className="font-medium">—</span>
          ) : (
            currencies.map(([code, count], i) => (
              <span key={code}>
                {i > 0 && ", "}
                <span className={`font-medium ${code === storeCurrency ? "" : "text-red-600"}`}>{code}</span> ({count})
              </span>
            ))
          )}
        </span>
        {unpriced > 0 && <span className="text-red-600">{unpriced} with no price</span>}
      </div>
      {needMainCategory.length > 0 && (
        <div className="border border-amber-600 bg-amber-50 px-4 py-3 mb-4 text-xs">
          <p className="mb-2">
            <span className="font-medium">
              {needMainCategory.length} product{needMainCategory.length === 1 ? "" : "s"} need
              {needMainCategory.length === 1 ? "s" : ""} a main category
            </span>{" "}
            — {needMainCategory.length === 1 ? "it is" : "they are"} only in New Arrivals, which every product leaves{" "}
            {NEW_ARRIVALS_DAYS} days after it&rsquo;s created. Once that happens{" "}
            {needMainCategory.length === 1 ? "it" : "they"} will still be published and buyable by direct link, but in
            no category a customer can browse to.
          </p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {needMainCategory.map((p) => (
              <li key={p.id}>
                <Link href={`/admin/products/${p.id}`} className="underline">
                  {p.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {demoCount > 0 && (
        <div className="border border-amber-600 bg-amber-50 px-4 py-3 mb-4 text-xs">
          <p className="mb-2">
            <span className="font-medium">
              {demoCount} placeholder product{demoCount === 1 ? "" : "s"} from the demo seed
            </span>{" "}
            {demoCount === 1 ? "is" : "are"} still in the catalogue. They have no images and aren&rsquo;t real stock —
            they&rsquo;re what a fresh install ships with so the storefront isn&rsquo;t empty.
          </p>
          <form action={removeDemoProducts}>
            <button type="submit" className="btn-secondary text-xs px-3 py-1.5">
              Remove {demoCount} placeholder product{demoCount === 1 ? "" : "s"}
            </button>
          </form>
          <p className="text-stone-600 mt-2">
            Matched by the exact seeded handles, so nothing you or an import created can be removed by this.
          </p>
        </div>
      )}
      {offCurrency > 0 && (
        <div className="border border-red-200 bg-red-50 px-4 py-3 mb-4 text-xs">
          <p className="text-red-700 mb-2">
            {offCurrency} product{offCurrency === 1 ? " is" : "s are"} priced in a currency other than{" "}
            <span className="font-medium">{storeCurrency}</span>. A cart can only be charged in one currency, so
            checkout refuses any basket that mixes them.
          </p>
          <form action={setCatalogueCurrency}>
            <input type="hidden" name="currency" value={storeCurrency} />
            <button type="submit" className="btn-secondary text-xs px-3 py-1.5">
              Label every price as {storeCurrency}
            </button>
          </form>
          <p className="text-stone-600 mt-2">
            This relabels the currency only — it does not convert the amounts, because there is no exchange rate here
            and applying an invented one to real prices would be worse than making you re-price. A variant priced 20
            stays 20, now as {storeCurrency}. Adjust anything that needs it in its editor afterwards.
          </p>
        </div>
      )}
      {draftCount > 0 && (
        <p className="text-xs text-stone-500 mb-4">
          {draftCount} product{draftCount === 1 ? "" : "s"} imported as Draft and not yet visible on the storefront — publish individually below
          or all at once above.
        </p>
      )}
      <ProductsTable products={products} storeCurrency={storeCurrency} categories={categoryChoices} />
    </div>
  );
}
