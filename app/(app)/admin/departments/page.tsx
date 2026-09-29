import type { Metadata } from "next";
import { listDepartmentsWithHeads } from "@/lib/data/admin";
import { PageHeader } from "@/components/ui/misc";
import { DepartmentsManager } from "@/components/admin/departments-manager";

export const metadata: Metadata = { title: "Departments" };

export default async function DepartmentsPage() {
  const d = await listDepartmentsWithHeads();
  return (
    <>
      <PageHeader title="Departments" lead="Heads see and manage every project in their departments. Heads must have the Department Head or Admin role." />
      <DepartmentsManager departments={d.departments} heads={d.heads} candidates={d.candidates} />
    </>
  );
}
