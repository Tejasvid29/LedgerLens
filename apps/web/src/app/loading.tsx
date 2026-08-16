/**
 * Next.js wraps the page in Suspense automatically and shows this while the
 * server-side fetch in page.tsx is in flight — both on first load and on
 * every wallet switch (each is a real navigation to a new ?wallet= value).
 *
 * Shaped like the real layout rather than a spinner, so nothing jumps once
 * the data arrives.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl animate-pulse px-6 py-12">
      <header className="mb-10 border-b border-rule pb-6">
        <div className="h-8 w-40 bg-rule/60" />
        <div className="mt-2 h-4 w-56 bg-rule/40" />
      </header>

      <div className="grid gap-8 lg:grid-cols-[280px_1fr]">
        <aside className="space-y-6">
          <div className="h-52 border border-rule bg-white" />
          <div className="h-40 border border-rule bg-white" />
        </aside>

        <main className="space-y-8">
          <div className="flex items-center justify-between">
            <div>
              <div className="h-6 w-32 bg-rule/60" />
              <div className="mt-2 h-3 w-24 bg-rule/40" />
            </div>
            <div className="h-8 w-48 bg-rule/40" />
          </div>

          <div>
            <div className="mb-3 h-3 w-20 bg-rule/40" />
            <div className="h-36 border border-rule bg-white" />
          </div>

          <div>
            <div className="mb-3 h-3 w-28 bg-rule/40" />
            <div className="h-64 border border-rule bg-white" />
          </div>
        </main>
      </div>
    </div>
  );
}
