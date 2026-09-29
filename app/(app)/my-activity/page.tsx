import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { listActivity } from "@/lib/data/admin";
import { PageHeader } from "@/components/ui/misc";
import { LogTable } from "@/components/data/log-table";

export const metadata: Metadata = { title: "My activity" };

export default async function MyActivityPage() {
  const s = await requireSession();
  const rows = await listActivity({}, { userId: s.userId });
  return (
    <>
      <PageHeader title="My activity" lead="Everything recorded about your work: assignments, updates, completions and red marks." />
      <LogTable rows={rows} />
    </>
  );
}
