export function PrivateDataNotice({ title, body }: { title: string; body: string }) {
  return (
    <section className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-8 text-center">
      <h2 className="text-lg font-semibold text-amber-100">{title}</h2>
      <p className="mt-2 text-sm text-amber-100/75">{body}</p>
    </section>
  );
}
