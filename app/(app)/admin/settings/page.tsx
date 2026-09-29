import type { Metadata } from "next";
import { getSettings } from "@/lib/data/admin";
import { PageHeader } from "@/components/ui/misc";
import { RulesForm } from "@/components/admin/rules-form";

export const metadata: Metadata = { title: "Rules and settings" };

export default async function AdminSettingsPage() {
  const settings = await getSettings();
  return (
    <>
      <PageHeader title="Rules and settings" lead="Changing working days or office hours recalculates the deadlines of every open task." />
      {settings ? <RulesForm settings={settings} /> : null}
    </>
  );
}
