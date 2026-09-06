#!/usr/bin/env python3
"""
Converts a WooCommerce product-export .xlsx into the CSV format apps/web's
/admin/products/import already understands — see
apps/web/lib/import/product-import.ts for the column contract this mirrors.

Usage:
    pip install pandas openpyxl beautifulsoup4
    python3 convert.py wc-product-export.xlsx -o products.csv

New products always land as status=DRAFT — review pricing, wording and
category assignment in the admin before publishing, regardless of what the
source export says.
"""

import argparse
import csv
import re
import sys

import pandas as pd
from bs4 import BeautifulSoup

PRODUCT_CSV_COLUMNS = [
    "handle", "title", "product_type", "short_description", "description",
    "price", "compare_at", "sku", "stock_on_hand", "category_handles",
    "brand", "material", "height_cm", "status", "image_urls",
]

CARE_KEYWORDS = ["cleaner", "detergent", "stain remover", "repair", "spray", "conditioner", "wash"]
ACCESSORY_KEYWORDS = ["bag", "tote", "hat", "belt", "jewelry", "jewellery", "accessories", "accessory"]

# Not real catalog products — WooCommerce order-adjustment/test placeholder
# rows that occasionally end up exported alongside the real catalogue.
EXCLUDE_PATTERNS = [
    re.compile(r"making\s+up\s+the\s+difference", re.IGNORECASE),
    re.compile(r"make\s+up\s+the\s+difference", re.IGNORECASE),
    re.compile(r"^test\d*$", re.IGNORECASE),
]

HEIGHT_RE = re.compile(r"(\d{2,3})\s?cm")


def slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def strip_html(html: str) -> str:
    if not isinstance(html, str) or not html.strip():
        return ""
    text = BeautifulSoup(html, "html.parser").get_text(separator=" ")
    # The source export has literal backslash-n (two characters, not real
    # newlines) baked into the description text between table rows — an
    # export artifact, not meaningful content.
    text = text.replace("\\n", " ")
    return re.sub(r"\s+", " ", text).strip()


def parse_spec_table(html: str) -> dict:
    """Extracts label->value pairs from the <table><tr><td>Label</td><td>Value</td></tr>...
    spec table WooCommerce descriptions use here. Returns {} if there's no table."""
    if not isinstance(html, str) or "<table" not in html:
        return {}
    soup = BeautifulSoup(html, "html.parser")
    specs = {}
    for row in soup.find_all("tr"):
        cells = row.find_all("td")
        if len(cells) >= 2:
            label = cells[0].get_text(strip=True).replace("\\n", " ").strip()
            value = cells[1].get_text(strip=True).replace("\\n", " ").strip()
            label = re.sub(r"[:\s]+$", "", label).strip()  # trailing ":" made "height:" a separate key from "height"
            if label:
                specs[label.lower()] = value
    return specs


def _matches_any(haystack: str, keywords: list[str]) -> bool:
    # Word-boundary matching, not naive substring `in`.
    return any(re.search(rf"\b{re.escape(kw)}\b", haystack) for kw in keywords)


def classify_product_type_and_categories(name: str, categories: str) -> tuple[str, str]:
    haystack = f"{name} {categories}".lower()

    if _matches_any(haystack, CARE_KEYWORDS):
        return "CARE_PRODUCT", "care"
    if _matches_any(haystack, ACCESSORY_KEYWORDS):
        return "ACCESSORY", "accessories"
    return "STANDARD", "new-arrivals"


def extract_material(name: str, categories: str, specs: dict) -> str:
    for key in ("material", "materials", "fabric"):
        if key in specs and specs[key]:
            return specs[key]
    if not isinstance(categories, str):
        return ""
    match = re.search(r"Shop By Material\s*>\s*([^,]+)", categories)
    if match:
        return match.group(1).strip()
    return ""


def extract_height(name: str, specs: dict) -> str:
    for key in ("height", "body height"):
        if key in specs and specs[key]:
            m = HEIGHT_RE.search(specs[key])
            if m:
                return m.group(1)
    m = HEIGHT_RE.search(name or "")
    return m.group(1) if m else ""


def convert(input_path: str, output_path: str, brand: str) -> None:
    df = pd.read_excel(input_path)
    used_handles: set[str] = set()
    rows = []
    type_counts: dict[str, int] = {}
    excluded: list[str] = []

    for _, row in df.iterrows():
        name = str(row.get("Name") or "").strip()
        if not name:
            continue
        if any(p.search(name) for p in EXCLUDE_PATTERNS):
            excluded.append(name)
            continue

        wc_id = row.get("ID")
        base_handle = slugify(name)
        handle = base_handle
        suffix = 2
        while handle in used_handles:
            handle = f"{base_handle}-{suffix}"
            suffix += 1
        used_handles.add(handle)

        categories = row.get("Categories") if isinstance(row.get("Categories"), str) else ""
        specs = parse_spec_table(row.get("Description"))
        product_type, category_handles = classify_product_type_and_categories(name, categories)
        type_counts[product_type] = type_counts.get(product_type, 0) + 1

        regular_price = row.get("Regular price")
        sale_price = row.get("Sale price")
        if pd.notna(sale_price):
            price, compare_at = sale_price, regular_price if pd.notna(regular_price) else ""
        else:
            price, compare_at = regular_price, ""

        images = row.get("Images") if isinstance(row.get("Images"), str) else ""

        rows.append({
            "handle": handle,
            "title": name,
            "product_type": product_type,
            "short_description": strip_html(row.get("Short description"))[:500],
            "description": strip_html(row.get("Description")),
            "price": "" if pd.isna(price) else str(price),
            "compare_at": "" if compare_at == "" or pd.isna(compare_at) else str(compare_at),
            "sku": f"WC-{int(wc_id)}" if pd.notna(wc_id) else "",
            "stock_on_hand": "",
            "category_handles": category_handles,
            "brand": brand,
            "material": extract_material(name, categories, specs),
            "height_cm": extract_height(name, specs),
            "status": "DRAFT",
            "image_urls": images.strip(),
        })

    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=PRODUCT_CSV_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)

    print(f"Wrote {len(rows)} product row(s) -> {output_path}")
    if excluded:
        print(f"Excluded {len(excluded)} non-product row(s) (order-adjustment/test placeholders): {excluded}")
    print("By product_type:", type_counts)
    print("\nAll rows import as status=DRAFT — review in /admin/products before publishing.")
    print("category_handles only reference handles already seeded in supabase/seed.sql")
    print("(dresses-kimonos, swim, accessories, care, new-arrivals, best-sellers, sale, bundles);")
    print("re-run classify_product_type_and_categories() adjustments here if your real taxonomy differs.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("input", help="Path to the WooCommerce product-export .xlsx")
    parser.add_argument("-o", "--output", default="products.csv", help="Output CSV path (default: products.csv)")
    parser.add_argument("--brand", default="", help="Brand value to stamp on every row")
    args = parser.parse_args()

    try:
        convert(args.input, args.output, args.brand)
    except Exception as exc:  # noqa: BLE001 - CLI tool, want a clean message
        print(f"Conversion failed: {exc}", file=sys.stderr)
        sys.exit(1)
