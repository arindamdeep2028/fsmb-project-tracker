import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The project picker of "Submit today's report" and "Responsibilities": one chip per project, the name first and
 * the code as secondary information; the chosen one is filled. Links (`?project=<id>`), so a choice is a fresh
 * page load and one project's data never mixes with another's.
 */
export function ProjectChooser({ projects, current, label = "Project", step, query }: {
  projects: { id: string; code: string; name: string }[]; current: string; label?: string; step?: number;
  /** other query parameters the links keep (e.g. view=responsibilities on the Projects page) */
  query?: Record<string, string>;
}) {
  const href = (id: string) => `?${new URLSearchParams({ ...query, project: id }).toString()}`;
  return (
    <div className="mb-6">
      <p className="mb-2 text-sm font-semibold text-ink">{step ? <StepNo n={step} /> : null}{label}</p>
      <nav className="flex flex-wrap gap-2" aria-label={label}>
        {projects.map((p) => (
          <Link key={p.id} href={href(p.id)} aria-current={p.id === current ? "page" : undefined} data-testid="project-choice"
            className={cn("flex flex-col rounded-md border px-3 py-1.5 text-left leading-tight", p.id === current ? "border-steel bg-steel text-white" : "border-line bg-panel hover:border-steel")}>
            <span className="text-sm font-medium">{p.name}</span>
            <span className={cn("text-[11px]", p.id === current ? "text-white/80" : "text-ink-soft")}>{p.code}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

/** The round step number of the daily update's steps (1 Project … 5 Submit). */
export function StepNo({ n, inverse }: { n: number; inverse?: boolean }) {
  return <span aria-hidden className={cn("mr-1.5 inline-grid h-5 w-5 place-items-center rounded-full text-[11px] font-semibold", inverse ? "bg-white text-steel" : "bg-steel text-white")}>{n}</span>;
}
