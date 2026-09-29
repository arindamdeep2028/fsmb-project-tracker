import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database";

export type Session = {
  userId: string;
  email: string | null;
  profile: Tables<"profiles">;
  isAdmin: boolean;
  headedDepartmentIds: string[];
  pmProjectIds: string[];
  memberProjectIds: string[];
};

/**
 * Layer 2 of routing: the live profile, department headships and memberships, read once per request
 * (v2 §12: never trust the JWT alone for scope).
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const [profile, heads, members] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", auth.user.id).maybeSingle(),
    supabase.from("department_heads").select("department_id").eq("user_id", auth.user.id),
    supabase.from("project_members").select("project_id, member_role").eq("user_id", auth.user.id).is("removed_at", null),
  ]);
  if (!profile.data) return null;
  const memberships = members.data ?? [];
  return {
    userId: auth.user.id,
    email: auth.user.email ?? null,
    profile: profile.data,
    isAdmin: profile.data.role === "admin" && profile.data.active,
    headedDepartmentIds: (heads.data ?? []).map((h) => h.department_id),
    pmProjectIds: memberships.filter((m) => m.member_role === "pm").map((m) => m.project_id),
    memberProjectIds: memberships.map((m) => m.project_id),
  };
});

/** Every signed-in page: active account, password already changed. */
export async function requireSession(opts: { allowPasswordChange?: boolean } = {}): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!s.profile.active) redirect("/auth/signout?reason=inactive");
  if (s.profile.must_change_password && !opts.allowPasswordChange) redirect("/change-password");
  return s;
}

export async function requireAdmin(): Promise<Session> {
  const s = await requireSession();
  if (!s.isAdmin) redirect("/");
  return s;
}

/** Admin, or head of at least one department. */
export async function requireHeadOrAdmin(): Promise<Session> {
  const s = await requireSession();
  if (!s.isAdmin && s.headedDepartmentIds.length === 0) redirect("/");
  return s;
}

/** v2 §12: My Projects is for a PM of at least one project, a Department Head or an Admin. */
export async function requireProjectManagerView(): Promise<Session> {
  const s = await requireSession();
  if (!s.isAdmin && s.headedDepartmentIds.length === 0 && s.pmProjectIds.length === 0) redirect("/dashboard");
  return s;
}
