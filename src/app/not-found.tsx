import Link from "next/link";

export default function NotFound() {
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 grid place-items-center p-6">
      <section className="w-full max-w-lg rounded-xl border border-neutral-800 bg-neutral-900 p-8 text-center">
        <p className="font-mono text-sm text-neutral-500">404</p>
        <h1 className="mt-2 text-2xl font-bold">Incident not found</h1>
        <p className="mt-3 text-sm text-neutral-400">
          It may have been removed, or the link may be incomplete.
        </p>
        <Link
          href="/incidents"
          className="mt-6 inline-block rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-white"
        >
          View incidents
        </Link>
      </section>
    </main>
  );
}
