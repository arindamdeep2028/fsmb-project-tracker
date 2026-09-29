import type { Metadata } from "next";
import { listActivity } from "@/lib/data/admin";
import { PageHeader } from "@/components/ui/misc";
import { LogTable } from "@/components/data/log-table";
import type { Enums } from "@/types/database";

export const metadata: Metadata = { title: "Log" };

const ACTIONS: Enums<"log_action">[] = ["Assigned", "Task created", "Plan submitted", "Daily update", "Daily report submitted", "Status change", "Completed", "Progress updated", "Contribution changed", "Extension granted", "Red mark", "Comment", "Project created", "Edited", "Member added", "Member removed", "User added", "Access denied", "Deleted"];

/** The full audit log. Append-only for everyone, Admin included (security protection S1). */
export default async function AdminLogPage({ searchParams }: { searchParams: Promise<{ project?: string; person?: string; action?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  const action = ACTIONS.includes(sp.action as Enums<"log_action">) ? (sp.action as Enums<"log_action">) : undefined;
  const rows = await listActivity({ project: sp.project, person: sp.person, action, from: sp.from, to: sp.to });
  return (
    <>
      <PageHeader title="Log" lead="Every change, red mark and deletion. Entries can't be edited or removed." />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">Project code<input name="project" defaultValue={sp.project} className="ml-2 h-9 w-24 rounded-md border border-line bg-panel px-2" /></label>
        <label className="text-sm">Action
          <select name="action" defaultValue={action ?? ""} className="ml-2 h-9 rounded-md border border-line bg-panel px-2"><option value="">Any</option>{ACTIONS.map((a) => <option key={a}>{a}</option>)}</select>
        </label>
        <label className="text-sm">From<input type="date" name="from" defaultValue={sp.from} className="ml-2 h-9 rounded-md border border-line bg-panel px-2" /></label>
        <label className="text-sm">To<input type="date" name="to" defaultValue={sp.to} className="ml-2 h-9 rounded-md border border-line bg-panel px-2" /></label>
        {sp.person ? <input type="hidden" name="person" value={sp.person} /> : null}
        <button className="h-9 rounded-md border border-line bg-panel px-3 text-sm font-medium hover:border-steel">Apply</button>
      </form>
      <LogTable rows={rows} csvName="fsmb-log" />
    </>
  );
}
