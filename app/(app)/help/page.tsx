import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { getSettings } from "@/lib/data/admin";
import { PageHeader, Section } from "@/components/ui/misc";

export const metadata: Metadata = { title: "Help" };

const DAYS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export default async function HelpPage() {
  await requireSession();
  const s = await getSettings();
  const workdays = (s?.workdays ?? [1, 2, 3, 4, 5]).map((d) => DAYS[d]).join(", ");
  return (
    <>
      <PageHeader title="Help" lead="The rules the tracker applies, in plain words." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Working days and deadlines">
          <div className="space-y-3 text-[15px]">
            <p>Working days are {workdays}. Saturday and Sunday are non-working: no deadline, overdue check, daily update or report falls on them.</p>
            <p>Office hours are {s?.office_start ?? 9}:00 to {s?.office_end ?? 18}:00 Dhaka time. A new task's clock starts at the next office hour.</p>
            <p>Submit your plan within {s?.plan_hours ?? 3} office hours, and finish within {s?.exec_days ?? 1} working day unless your manager sets another deadline or grants an extension.</p>
          </div>
        </Section>
        <Section title="Red marks">
          <ul className="list-disc space-y-2 pl-5 text-[15px]">
            <li>The plan wasn't submitted in time.</li>
            <li>The execution deadline passed before completion.</li>
            <li>No daily update on a working day while the task is open.</li>
            <li>The task was completed after its deadline.</li>
          </ul>
        </Section>
        <Section title="Daily reports">
          <p className="text-[15px]">One report per project per working day. Tick the tasks you worked on to update their progress and status. You can edit today's report until it locks; add up to {s?.attachment_max_files ?? 10} photos or files.</p>
        </Section>
        <Section title="Progress and contribution">
          <p className="text-[15px]">You type progress on tasks without subtasks. A parent's progress is calculated from its subtasks, weighted by each one's share. Project completion adds up every task's share.</p>
        </Section>
      </div>
    </>
  );
}
