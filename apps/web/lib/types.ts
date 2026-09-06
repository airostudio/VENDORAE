export type ProductType =
  | "standard"
  | "accessory"
  | "care_product"
  | "bundle";

export interface Category {
  id: string;
  handle: string;
  name: string;
  description?: string;
  heroImageUrl?: string;
  parentHandle?: string;
}

export interface ProductSpecGroup {
  group: string;
  items: { label: string; value: string }[];
}

export interface ProductSummary {
  id: string;
  slug: string;
  title: string;
  productType: ProductType;
  categoryHandles: string[];
  priceCents: number;
  compareAtCents?: number;
  currency: string;
  shortDescription: string;
  imageUrl: string;
  imageAlt: string;
  isNew?: boolean;
  isBestSeller?: boolean;
  onSale?: boolean;
  readyToShip?: boolean;
  rating?: number;
  reviewCount?: number;
  tags: string[];
  material?: string;
  isIndexable?: boolean;
}

export interface ProductVariantSummary {
  id: string;
  title: string | null;
  sku: string | null;
  priceCents: number;
  compareAtCents?: number;
  currency: string;
  /** e.g. [["Color", "Blue"], ["Size", "M"]] — only the options this variant actually defines. */
  options: Array<{ name: string; value: string }>;
  inStock: boolean;
}

export interface ProductDetail extends ProductSummary {
  /** Buyable variants, cheapest first. A product always has at least one. */
  variants: ProductVariantSummary[];
  gallery: { url: string; alt: string }[];
  description: string;
  specGroups: ProductSpecGroup[];
  whatsIncluded: string[];
  careSummary: string;
  deliverySummary: string;
  warrantySummary: string;
  faqs: { q: string; a: string }[];
  compatibleAccessorySlugs: string[];
  relatedSlugs: string[];
}
