"use client";
import { useState } from "react";
import { inviteUser, sendResetLink, updateUser } from "@/lib/actions/admin";
import { roleLabel } from "@/lib/labels";
import { useAction, useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, FormMessage, Input, Select } from "@/components/ui/form";
import { Badge, Table } from "@/components/ui/misc";
import type { Enums } from "@/types/database";

type Role = Enums<"user_role">;
type User = { id: string; full_name: string; login_name: string; email: string | null; role: Role; department_id: string | null; active: boolean; must_change_password: boolean; department: { name: string } | null };
const ROLES: Role[] = ["engineer", "pm", "dept_head", "admin"];

export function UserTable({ users, departments }: { users: User[]; departments: { id: string; name: string }[] }) {
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [filter, setFilter] = useState("");
  const { pending, run } = useAction();
  const shown = users.filter((u) => `${u.full_name} ${u.login_name} ${u.email}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap justify-between gap-2">
        <Input placeholder="Find a person" aria-label="Find a person" value={filter} onChange={(e) => setFilter(e.target.value)} className="max-w-xs" />
        <Button onClick={() => setInviting(true)}>Add user</Button>
      </div>
      <Table className="rounded-lg border border-line bg-panel">
        <thead><tr><th>Name</th><th>Login</th><th>Role</th><th>Department</th><th>Status</th><th /></tr></thead>
        <tbody>
          {shown.map((u) => (
            <tr key={u.id} className={u.active ? undefined : "text-ink-faint"}>
              <td className="font-medium">{u.full_name}<div className="text-xs font-normal text-ink-soft">{u.email}</div></td>
              <td>{u.login_name}</td>
              <td>{roleLabel[u.role]}</td>
              <td>{u.department?.name ?? "—"}</td>
              <td>{u.active ? (u.must_change_password ? <Badge signal="amber">First sign-in pending</Badge> : <Badge signal="green">Active</Badge>) : <Badge signal="done">Inactive</Badge>}</td>
              <td className="whitespace-nowrap text-right">
                <Button variant="ghost" size="sm" onClick={() => setEditing(u)}>Edit</Button>
                <Button variant="ghost" size="sm" pending={pending} onClick={() => run(() => sendResetLink(u.id))}>Send reset link</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      {inviting ? <InviteDialog departments={departments} onClose={() => setInviting(false)} /> : null}
      {editing ? <EditDialog user={editing} departments={departments} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

/** Create user: the admin sets the password; it goes only to Supabase Auth and is never shown again. */
function InviteDialog({ departments, onClose }: { departments: { id: string; name: string }[]; onClose: () => void }) {
  const [v, setV] = useState({ full_name: "", login_name: "", email: "", role: "engineer" as Role, department_id: "", password: "", confirm_password: "" });
  const [result, setResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const [pending, setPending] = useState(false);
  const toast = useToast();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Add a user" description="Share the password with them privately. They must choose their own password at first sign-in.">
        <form className="space-y-4" onSubmit={async (e) => {
          e.preventDefault();
          if (v.password !== v.confirm_password) { setResult({ ok: false, message: "The two passwords don't match." }); return; }
          setPending(true);
          const r = await inviteUser(v);
          setPending(false);
          if (!r.ok) { setResult(r); return; }
          toast({ ok: true, message: r.message });
          onClose();
        }}>
          <Field label="Full name" htmlFor="u-name"><Input id="u-name" value={v.full_name} onChange={(e) => setV({ ...v, full_name: e.target.value })} required /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Login name" htmlFor="u-login"><Input id="u-login" value={v.login_name} onChange={(e) => setV({ ...v, login_name: e.target.value.toLowerCase() })} required autoComplete="off" /></Field>
            <Field label="Email" htmlFor="u-email"><Input id="u-email" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} required autoComplete="off" /></Field>
            <Field label="Password" htmlFor="u-pw" hint="At least 10 characters.">
              <Input id="u-pw" type="password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} required minLength={10} maxLength={72} autoComplete="new-password" />
            </Field>
            <Field label="Confirm password" htmlFor="u-pw2">
              <Input id="u-pw2" type="password" value={v.confirm_password} onChange={(e) => setV({ ...v, confirm_password: e.target.value })} required minLength={10} maxLength={72} autoComplete="new-password" />
            </Field>
            <Field label="Role" htmlFor="u-role"><Select id="u-role" value={v.role} onChange={(e) => setV({ ...v, role: e.target.value as Role })}>{ROLES.map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}</Select></Field>
            <Field label="Department" htmlFor="u-dept"><Select id="u-dept" value={v.department_id} onChange={(e) => setV({ ...v, department_id: e.target.value })} required><option value="">Choose a department</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
          </div>
          <FormMessage result={result && !result.ok ? result : null} />
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" pending={pending}>Create account</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({ user, departments, onClose }: { user: User; departments: { id: string; name: string }[]; onClose: () => void }) {
  const [v, setV] = useState({ full_name: user.full_name, login_name: user.login_name, role: user.role, department_id: user.department_id ?? "", active: user.active });
  const { pending, run } = useAction();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Edit ${user.full_name}`} description="The last active admin can't be demoted or deactivated.">
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run(() => updateUser(user.id, { ...v, department_id: v.department_id || null }), onClose); }}>
          <Field label="Full name" htmlFor="e-name"><Input id="e-name" value={v.full_name} onChange={(e) => setV({ ...v, full_name: e.target.value })} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Login name" htmlFor="e-login"><Input id="e-login" value={v.login_name} onChange={(e) => setV({ ...v, login_name: e.target.value.toLowerCase() })} /></Field>
            <Field label="Role" htmlFor="e-role"><Select id="e-role" value={v.role} onChange={(e) => setV({ ...v, role: e.target.value as Role })}>{ROLES.map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}</Select></Field>
            <Field label="Department" htmlFor="e-dept"><Select id="e-dept" value={v.department_id} onChange={(e) => setV({ ...v, department_id: e.target.value })}><option value="">None</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} /> Account active (inactive people can't sign in)</label>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" pending={pending}>Save user</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
