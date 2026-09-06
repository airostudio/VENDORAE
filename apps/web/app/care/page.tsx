import { getAllProducts } from "@/lib/data/products";
import CareClient from "./CareClient";

export const dynamic = "force-dynamic";

export default async function CarePage() {
  const products = await getAllProducts();
  return <CareClient products={products} />;
}
