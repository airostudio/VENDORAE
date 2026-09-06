"use client";

import { useState } from "react";

export default function PrivacyPage() {
  const [settings, setSettings] = useState({
    saveRecentlyViewed: true,
    marketingOptIn: false,
  });

  const rows: { key: keyof typeof settings; label: string; help: string }[] = [
    { key: "saveRecentlyViewed", label: "Save recently viewed products", help: "Turn off to stop the site remembering products you've looked at." },
    { key: "marketingOptIn", label: "Marketing emails", help: "Receive occasional product updates and offers." },
  ];

  return (
    <div className="max-w-lg space-y-6">
      {rows.map((row) => (
        <label key={row.key} className="flex items-start gap-3 border border-stone-200 p-4">
          <input
            type="checkbox"
            className="mt-1"
            checked={settings[row.key]}
            onChange={(e) => setSettings((s) => ({ ...s, [row.key]: e.target.checked }))}
          />
          <span>
            <span className="text-sm block">{row.label}</span>
            <span className="text-xs text-stone-500">{row.help}</span>
          </span>
        </label>
      ))}
      <button className="btn-primary">Clear Recently Viewed Products</button>
    </div>
  );
}
