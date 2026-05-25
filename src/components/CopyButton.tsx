"use client";

import { useState } from "react";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // ignore
        }
      }}
      className="text-xs px-2 py-0.5 rounded border border-neutral-700 hover:border-neutral-500 text-neutral-400 hover:text-neutral-200"
    >
      {copied ? "Copied" : label}
    </button>
  );
}
