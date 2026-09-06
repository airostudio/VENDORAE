import Link from "next/link";

const links = [
  { href: "/account", label: "Overview" },
  { href: "/account/orders", label: "Orders" },
  { href: "/account/products", label: "My Products" },
  { href: "/account/wishlist", label: "Wishlists" },
  { href: "/account/addresses", label: "Addresses" },
  { href: "/account/profile", label: "Profile" },
  { href: "/account/privacy", label: "Privacy" },
  { href: "/account/support", label: "Support" },
];

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="container-page py-14">
      <h1 className="font-serif text-4xl mb-10">My Account</h1>
      <div className="grid lg:grid-cols-[220px_1fr] gap-12">
        <nav className="space-y-1">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="block text-sm py-2 text-ink-800 hover:text-ink-950">
              {l.label}
            </Link>
          ))}
        </nav>
        <div>{children}</div>
      </div>
    </div>
  );
}
