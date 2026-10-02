import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/session";
import { listUsers } from "@/lib/data/admin";
import { getDepartments } from "@/lib/data/projects";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { UserTable } from "@/components/admin/user-table";

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage() {
  const s = await requireAdmin();
  const [users, departments] = await Promise.all([
    listUsers().then((rows) => ({ rows, error: null }), (e: Error) => ({ rows: [], error: e.message })),
    getDepartments(),
  ]);
  return (
    <>
      <PageHeader title="Users" lead="Accounts, roles and departments. Passwords and login emails change only through Supabase Auth." />
      {users.error ? <EmptyState title="The user list couldn't be loaded">{users.error}</EmptyState>
        : <UserTable users={users.rows} departments={departments.filter((d) => d.active)} meId={s.userId} />}
    </>
  );
}
