export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="hidden flex-col justify-between bg-graphite p-10 text-white md:flex">
        <div className="text-sm text-white/70">Frontier Semiconductor Bangladesh</div>
        <div>
          <p className="max-w-[22ch] text-4xl font-semibold leading-tight">FSMB Project Management App</p>
          <p className="mt-3 text-lg text-white/70">Projects. Responsibilities. Progress.</p>
          <div className="mt-8 flex gap-3" aria-hidden>
            <span className="h-1.5 w-16 rounded-full bg-signal-green" />
            <span className="h-1.5 w-10 rounded-full bg-signal-amber" />
            <span className="h-1.5 w-6 rounded-full bg-signal-red" />
          </div>
        </div>
        <div className="text-sm text-white/60">FSMB Project Tracker</div>
      </div>
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </main>
  );
}
