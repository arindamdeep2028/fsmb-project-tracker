import type { Metadata } from "next";
import { listDemoProjects, listJobRuns } from "@/lib/data/admin";
import { PageHeader, Section } from "@/components/ui/misc";
import { DemoProjects, JobTable } from "@/components/admin/job-table";

export const metadata: Metadata = { title: "Data and jobs" };

export default async function AdminDataPage() {
  const [runs, demos] = await Promise.all([listJobRuns(), listDemoProjects()]);
  return (
    <>
      <PageHeader title="Data and jobs" lead="Scheduled scans run inside the database (pg_cron). Run now repeats a job immediately; scans skip Saturday and Sunday." />
      <div className="space-y-6">
        <Section title="Scheduled jobs"><JobTable runs={runs} /></Section>
        <Section title="Sample projects"><DemoProjects projects={demos} /></Section>
        <Section title="Backups">
          <p className="text-[15px]">Supabase keeps daily database backups; a GitHub Actions workflow keeps an off-site copy. Restores are done from the Supabase dashboard, not from this app.</p>
        </Section>
      </div>
    </>
  );
}
