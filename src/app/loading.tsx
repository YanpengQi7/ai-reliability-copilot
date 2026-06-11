export default function Loading() {
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 p-6 md:p-10">
      <div className="max-w-5xl mx-auto space-y-6 animate-pulse">
        <div className="h-9 w-64 rounded bg-neutral-800" />
        <div className="h-32 rounded-xl border border-neutral-800 bg-neutral-900" />
        <div className="h-64 rounded-xl border border-neutral-800 bg-neutral-900" />
      </div>
    </main>
  );
}
