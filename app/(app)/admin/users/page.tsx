import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { roleLabel } from "@/lib/labels";
import type { Enums } from "@/types/database";
import { listUsers } from "@/lib/data/admin";
import { getDepartments } from "@/lib/data/projects";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { UserTable } from "@/components/admin/user-table";

export const metadata: Metadata = { title: "Users" };

const ROLES = ["admin", "dept_head", "pm", "engineer"];

/** Admin dashboard figures open this list filtered: ?status=active, ?role=<role> (active people), ?noproject=1. */
export default async function UsersPage({ searchParams }: { searchParams: Promise<{ status?: string; role?: string; noproject?: string }> }) {
  const s = await requireAdmin();
  const sp = await searchParams;
  const role = ROLES.includes(sp.role ?? "") ? (sp.role as Enums<"user_role">) : undefined;
  const filtered = Boolean(sp.status === "active" || role || sp.noproject);
  const supabase = await createClient();
  const onProject = sp.noproject
    ? new Set(((await supabase.from("project_members").select("user_id").is("removed_at", null)).data ?? []).map((m) => m.user_id))
    : null;
  const [users, departments] = await Promise.all([
    listUsers().then((rows) => ({ rows, error: null }), (e: Error) => ({ rows: [], error: e.message })),
    getDepartments(),
  ]);
  // the same definitions as v_admin_overview: active people, by role, without a current project membership
  const rows = filtered
    ? users.rows.filter((u) => u.active && (!role || u.role === role) && (!onProject || !onProject.has(u.id)))
    : users.rows;
  return (
    <>
      <PageHeader title="Users" lead="Accounts, roles and departments. Passwords and login emails change only through Supabase Auth." />
      {filtered && !users.error ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-steel/30 bg-steel-wash px-4 py-2 text-sm" data-testid="users-filter">
          <span>Showing <strong>active {role ? `${roleLabel[role]}s` : "users"}{sp.noproject ? " not on any project" : ""}</strong>
            {" · "}<span data-testid="record-count">{rows.length} user{rows.length === 1 ? "" : "s"}</span></span>
          <Link href="/admin/users" className="text-steel hover:underline">Clear filter</Link>
        </div>
      ) : null}
      {users.error ? <EmptyState title="The user list couldn't be loaded">{users.error}</EmptyState>
        : <UserTable users={rows} departments={departments.filter((d) => d.active)} meId={s.userId} />}
    </>
  );
}
