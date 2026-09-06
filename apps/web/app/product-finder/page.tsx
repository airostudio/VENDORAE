import { getAllProducts } from "@/lib/data/products";
import ProductFinderClient from "./ProductFinderClient";

export const dynamic = "force-dynamic";

export default async function ProductFinderPage() {
  const products = await getAllProducts();
  return <ProductFinderClient products={products} />;
}
