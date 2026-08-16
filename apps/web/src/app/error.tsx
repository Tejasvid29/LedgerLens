'use client';

/**
 * Next.js requires error.tsx to be a Client Component — it needs `reset` to
 * retry rendering the segment. This only catches what page.tsx doesn't:
 * page.tsx already wraps its own fetches in try/catch and renders an inline
 * banner for a reachable-but-failing API, so this is the backstop for
 * something actually throwing (a render bug, not an API error).
 */
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <div className="border border-oxblood/30 bg-oxblood/5 p-8 text-center">
        <p className="text-oxblood">Something went wrong loading the dashboard.</p>
        <button
          onClick={reset}
          className="mt-4 border border-oxblood/40 px-4 py-1.5 text-sm text-oxblood hover:bg-oxblood/10"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
