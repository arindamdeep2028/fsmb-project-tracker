import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <h1 className="text-2xl font-semibold">This page isn't available</h1>
      <p className="mt-2 text-ink-soft">It doesn't exist, or your role or project membership doesn't include it.</p>
      <Link href="/" className="mt-6 inline-block font-medium text-steel hover:underline">Go to your dashboard</Link>
    </main>
  );
}
