import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getProjectTaskTree } from "@/lib/data/tasks";
import { getProjectEngineers } from "@/lib/data/projects";
import { capsForTree } from "@/lib/auth/task-caps";
import { canManageProject } from "@/lib/auth/capabilities";
import { EmptyState, PageHeader, Section } from "@/components/ui/misc";
import { TaskTree } from "@/components/tasks/task-tree";
import type { TaskNode } from "@/types/domain";

export const metadata: Metadata = { title: "My Tasks" };

/** Every open task assigned to me, grouped by project, with the same row actions as the project tree. */
export default async function MyTasksPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const s = await requireSession();
  const { filter } = await searchParams;
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
