import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ShopGrid from "@/components/ShopGrid";
import { getCategoryByHandle } from "@/lib/data/categories";
import { getAllProducts, getProductsByCategory } from "@/lib/data/products";

export const dynamic = "force-dynamic";

interface Props {
  params: { slug?: string[] };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const handle = params.slug?.join("/");
  const category = handle ? await getCategoryByHandle(handle) : undefined;
  const title = category ? category.name : "Shop All";
  return { title, description: category?.description ?? "Browse the full Beach Footprints catalogue." };
}

export default async function ShopPage({ params }: Props) {
  const handle = params.slug?.join("/");

  if (!handle) {
    const products = await getAllProducts();
    return <ShopGrid products={products} title="Shop All" description="Every product across the Beach Footprints catalogue." />;
  }

  const category = await getCategoryByHandle(handle);
  if (!category) notFound();

  const parent = category.parentHandle ? await getCategoryByHandle(category.parentHandle) : undefined;
  const products = await getProductsByCategory(handle);
  return (
    <ShopGrid
      products={products}
      title={category.name}
      description={category.description}
      breadcrumb={parent ? [{ label: parent.name, href: `/shop/${parent.handle}` }, { label: category.name }] : undefined}
    />
  );
}
