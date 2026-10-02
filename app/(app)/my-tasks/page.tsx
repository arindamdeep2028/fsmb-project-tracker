import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getProjectTaskTree } from "@/lib/data/tasks";
import { getProjectEngineers } from "@/lib/data/projects";
import { getSettings } from "@/lib/data/admin";
import { taskRecords } from "@/lib/data/task-records";
import { capsForTree } from "@/lib/auth/task-caps";
import { canManageProject } from "@/lib/auth/capabilities";
import { filterLabel, isTaskFilter, type TaskFilter, type Window } from "@/lib/drill";
import { EmptyState, PageHeader, Section } from "@/components/ui/misc";
import { TaskTree } from "@/components/tasks/task-tree";
import { fmtDate } from "@/lib/time";
import type { TaskNode } from "@/types/domain";

export const metadata: Metadata = { title: "My Tasks" };

type Search = { filter?: string; user?: string; dept?: string; project?: string; managed?: string; all?: string; from?: string; to?: string; recent?: string };
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Every open task assigned to me, grouped by project, with the same row actions as the project tree.
 * Dashboard figures open this page with filters (scope, person, filter, window): it then lists exactly the
 * records behind the figure, from the tasks the viewer can see.
 */
export default async function MyTasksPage({ searchParams }: { searchParams: Promise<Search> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const drill = Boolean(sp.user || sp.dept || sp.project || sp.managed || sp.all || sp.from || sp.to || sp.recent)
    || (isTaskFilter(sp.filter) && !["red", "done"].includes(sp.filter));
  if (drill && isTaskFilter(sp.filter ?? "open")) return <TaskRecordsView s={s} sp={sp} />;

  const filter = sp.filter;
  const supabase = await createClient();
  const { data: projects } = await supabase.from("projects").select("id, code, name, department_id")
    .in("id", s.memberProjectIds.length ? s.memberProjectIds : ["00000000-0000-0000-0000-000000000000"]).eq("archived", false).order("code");
  const groups = await Promise.all((projects ?? []).map(async (p) => {
    let nodes = await getProjectTaskTree(p.id, { onlyUser: s.userId });
    const keep = (n: TaskNode) => (filter === "red" ? n.is_red : filter === "done" ? n.status === "Completed" : n.status !== "Completed");
    nodes = nodes.map((n) => ({ ...n, children: n.children.filter(keep) })).filter((n) => keep(n) || n.children.length);
    const engineers = await getProjectEngineers(p.id);
    return { p, nodes, caps: capsForTree(s, p, nodes), engineers, manages: canManageProject(s, p) };
  }));
  const shown = groups.filter((g) => g.nodes.length);
  const tabs = [["", "Open"], ["red", "Red marks"], ["done", "Completed"]] as const;
  return (
    <>
      <PageHeader title="My Tasks" lead="Update status and progress here, or tick tasks in your daily report." />
      <nav className="mb-5 flex gap-1" aria-label="Filter">
        {tabs.map(([k, label]) => (
          <a key={k} href={k ? `?filter=${k}` : "?"} aria-current={(filter ?? "") === k ? "page" : undefined}
            className="rounded-md px-3 py-1.5 text-sm text-ink-soft hover:bg-steel-wash aria-[current=page]:bg-steel aria-[current=page]:text-white">{label}</a>
        ))}
      </nav>
      {shown.length === 0 ? <EmptyState title={filter === "red" ? "No red marks. Nice." : "No tasks here."} /> : (
        <div className="space-y-6">
          {shown.map((g) => (
            <Section key={g.p.id} title={`${g.p.code} ${g.p.name}`}>
              <TaskTree nodes={g.nodes} caps={g.caps} projectId={g.p.id} meId={s.userId} assignees={g.engineers}
                canCreate={false} managerView={g.manages} basePath={`/projects/${g.p.id}/tasks`} />
            </Section>
          ))}
        </div>
      )}
    </>
  );
}

/** The records behind a dashboard figure (see lib/drill.ts for the definitions). */
async function TaskRecordsView({ s, sp }: { s: Awaited<ReturnType<typeof requireSession>>; sp: Search }) {
  const f = (sp.filter ?? "open") as TaskFilter;
  const settings = await getSettings();
  const w: Window = sp.recent
    ? { since: Date.now() - (settings?.review_window_days ?? 30) * 864e5 }
    : { from: sp.from && ISO.test(sp.from) ? sp.from : undefined, to: sp.to && ISO.test(sp.to) ? sp.to : undefined };
  const scoped = Boolean(sp.dept || sp.project || sp.managed || sp.all);
  const user = sp.user && UUID.test(sp.user) ? sp.user : scoped ? undefined : s.userId;   // no scope: my own tasks
  const scope = { dept: sp.dept && UUID.test(sp.dept) ? sp.dept : undefined, project: sp.project && UUID.test(sp.project) ? sp.project : undefined, managed: Boolean(sp.managed) };
  const supabase = await createClient();
  const [records, dept, person] = await Promise.all([
    taskRecords(f, scope, w, user),
    scope.dept ? supabase.from("departments").select("name").eq("id", scope.dept).maybeSingle() : Promise.resolve({ data: null }),
    user && user !== s.userId ? supabase.from("profiles").select("full_name").eq("id", user).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const groups = await Promise.all(records.groups.map(async (g) => ({
    ...g, caps: capsForTree(s, g.project, g.nodes), engineers: await getProjectEngineers(g.project.id), manages: canManageProject(s, g.project),
  })));
  const scopeText = [
    scope.dept ? `${dept.data?.name ?? "Department"} department` : null,
    scope.project ? groups[0]?.project.code ?? null : null,
    scope.managed ? "projects you manage" : null,
    sp.all ? "all projects" : null,
    user === s.userId ? "assigned to me" : user ? `assigned to ${person.data?.full_name ?? "this person"}` : null,
  ].filter(Boolean).join(" · ");
  const windowText = sp.recent ? `last ${settings?.review_window_days ?? 30} days` : w.from || w.to ? `${fmtDate(w.from ?? null)} to ${fmtDate(w.to ?? null)}` : null;
  const events = f === "extended" ? `${records.events} extension${records.events === 1 ? "" : "s"} granted · ` : f === "redmark" ? `${records.events} red-mark event${records.events === 1 ? "" : "s"} · ` : "";
  return (
    <>
      <PageHeader title={filterLabel[f]}
        lead={<>{[scopeText, windowText].filter(Boolean).join(" · ")}{scopeText || windowText ? <br /> : null}
          <span data-testid="record-count">{events}{records.total} task{records.total === 1 ? "" : "s"}</span> · only records you have access to are listed</>}
        actions={<Link href="/my-tasks" className="text-sm text-steel hover:underline">Clear filters</Link>} />
      {groups.length === 0 ? <EmptyState title="No matching tasks." /> : (
        <div className="space-y-6">
          {groups.map((g) => (
            <Section key={g.project.id} title={`${g.project.code} ${g.project.name}`} aside={<span className="text-sm text-ink-soft">{g.count} task{g.count === 1 ? "" : "s"}</span>}>
              <TaskTree nodes={g.nodes} caps={g.caps} projectId={g.project.id} meId={s.userId} assignees={g.engineers}
                canCreate={false} managerView={g.manages} basePath={`/projects/${g.project.id}/tasks`} />
            </Section>
          ))}
        </div>
      )}
    </>
  );
}
