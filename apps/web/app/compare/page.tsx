import { getAllProducts } from "@/lib/data/products";
import CompareClient from "./CompareClient";

export const dynamic = "force-dynamic";

export default async function ComparePage() {
  const products = await getAllProducts();
  return <CompareClient products={products} />;
}
