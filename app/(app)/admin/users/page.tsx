import type { Metadata } from "next";
import { listUsers } from "@/lib/data/admin";
import { getDepartments } from "@/lib/data/projects";
import { PageHeader } from "@/components/ui/misc";
import { UserTable } from "@/components/admin/user-table";

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage() {
  const [users, departments] = await Promise.all([listUsers(), getDepartments()]);
  return (
    <>
      <PageHeader title="Users" lead="Accounts, roles and departments. Passwords and login emails change only through Supabase Auth." />
      <UserTable users={users} departments={departments.filter((d) => d.active)} />
    </>
  );
}
