"use client";
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <h1 className="text-2xl font-semibold">This page couldn't load</h1>
      <p className="mt-2 text-ink-soft">The data service didn't answer. Check your connection and try again.</p>
      <button onClick={reset} className="mt-6 rounded-md bg-steel px-4 py-2 font-medium text-white">Try again</button>
    </main>
  );
}
