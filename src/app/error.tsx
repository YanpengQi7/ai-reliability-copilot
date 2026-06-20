"use client";

import Link from "next/link";

export default function ErrorPage({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 grid place-items-center p-6">
      <section className="w-full max-w-lg rounded-xl border border-neutral-800 bg-neutral-900 p-8 text-center">
        <p className="font-mono text-sm text-amber-300">UNAVAILABLE</p>
        <h1 className="mt-2 text-2xl font-bold">Could not load this page</h1>
        <p className="mt-3 text-sm text-neutral-400">
          A dependency may be temporarily unavailable. Retry the request, or return home and try again later.
        </p>
        {error.digest && <p className="mt-3 font-mono text-xs text-neutral-600">reference: {error.digest}</p>}
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => unstable_retry()}
            className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-white"
          >
            Try again
          </button>
          <Link
            href="/"
            className="rounded-md border border-neutral-700 px-4 py-2 text-sm font-medium text-neutral-200 hover:border-neutral-500 hover:text-white"
          >
            Go home
          </Link>
        </div>
      </section>
    </main>
  );
}
