"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[route-error]", error);
  }, [error]);

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 grid place-items-center p-6">
      <section className="w-full max-w-lg rounded-xl border border-red-500/30 bg-neutral-900 p-8 text-center">
        <p className="text-sm font-medium text-red-300">Request failed</p>
        <h1 className="mt-2 text-2xl font-bold">This page could not be loaded.</h1>
        <p className="mt-3 text-sm text-neutral-400">
          The database or an upstream service may be temporarily unavailable.
        </p>
        {error.digest && <p className="mt-2 font-mono text-xs text-neutral-600">Error ID: {error.digest}</p>}
        <button
          type="button"
          onClick={() => unstable_retry()}
          className="mt-6 rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-white"
        >
          Try again
        </button>
      </section>
    </main>
  );
}
