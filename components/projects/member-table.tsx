"use client";
import { useState } from "react";
import { addMember, changeMemberRole, removeMember } from "@/lib/actions/projects";
import { roleLabel } from "@/lib/labels";
import { projectRolesFor } from "@/lib/auth/capabilities";
import { useAction } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Select } from "@/components/ui/form";
import { Badge, Table } from "@/components/ui/misc";
import type { Member } from "@/types/domain";
import type { Enums } from "@/types/database";

type Candidate = { user_id: string; full_name: string; role: Enums<"user_role">; department: string | null; is_member: boolean };
type ProjectRole = Enums<"project_member_role">;

/** Members with open tasks, and the lead PM, can't be removed until reassigned (integrity rule I2). */
export function MemberTable({ projectId, members, candidates, canManage, canAddPm, leadPmId }: {
  projectId: string; members: (Member & { open_tasks?: number; share_pct?: number | null })[]; candidates: Candidate[];
  canManage: boolean; canAddPm: boolean; leadPmId: string | null;
}) {
  const { pending, run } = useAction();
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState("");
  const [role, setRole] = useState<ProjectRole>("engineer");
  const available = candidates.filter((c) => !c.is_member);
  const whoRoles = projectRolesFor(candidates.find((c) => c.user_id === who)?.role ?? "engineer", canAddPm);
  const chosenRole = whoRoles.includes(role) ? role : whoRoles[0];
  return (
    <div className="space-y-3">
      {canManage ? <div className="flex justify-end"><Button size="sm" onClick={() => setOpen(true)} disabled={!available.length}>Add member</Button></div> : null}
      <Table>
        <thead><tr><th>Person</th><th>Project role</th><th>Account role</th><th>Open tasks</th><th>Share</th>{canManage ? <th /> : null}</tr></thead>
        <tbody>
          {members.map((m) => {
            const roles = projectRolesFor(m.role, canAddPm);
            const canRemove = m.user_id !== leadPmId && (canAddPm || m.member_role === "engineer");
            return (
              <tr key={m.user_id}>
                <td className="font-medium">{m.full_name} {m.user_id === leadPmId ? <Badge>Lead PM</Badge> : null}</td>
                <td>
                  {canManage && canAddPm && m.user_id !== leadPmId && roles.length > 1 ? (
                    <select aria-label={`Project role of ${m.full_name}`} value={m.member_role} disabled={pending} className="h-8 rounded-md border border-line bg-panel px-2 text-sm"
                      onChange={(e) => run(() => changeMemberRole(projectId, m.user_id, e.target.value as ProjectRole))}>
                      {roles.map((r) => <option key={r} value={r}>{r === "pm" ? "PM" : "Engineer"}</option>)}
                    </select>
                  ) : m.member_role === "pm" ? "PM" : "Engineer"}
                </td>
                <td className="text-ink-soft">{roleLabel[m.role]}</td>
                <td>{m.open_tasks ?? "—"}</td>
                <td>{m.share_pct == null ? "—" : `${Number(m.share_pct).toFixed(1)}%`}</td>
                {canManage ? (
                  <td className="text-right">
                    <Button variant="ghost" size="sm" disabled={pending || !canRemove}
                      title={m.user_id === leadPmId ? "Change the lead PM in project settings first" : !canRemove ? "An admin or the department head removes a PM" : undefined}
                      onClick={() => confirm(`Remove ${m.full_name} from this project?`) && run(() => removeMember(projectId, m.user_id))}>Remove</Button>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </Table>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Add a member" description="Any active user. They see this project, its tasks and the daily updates straight away, and can report on it.">
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (who && chosenRole) run(() => addMember(projectId, who, chosenRole), () => { setOpen(false); setWho(""); }); }}>
            <Field label="Person" htmlFor="m-who">
              <Select id="m-who" value={who} onChange={(e) => setWho(e.target.value)} required>
                <option value="">Choose a person</option>
                {available.map((c) => {
                  const ok = projectRolesFor(c.role, canAddPm).length > 0;
                  return (
                    <option key={c.user_id} value={c.user_id} disabled={!ok}>
                      {c.full_name} · {roleLabel[c.role]}{c.department ? ` · ${c.department}` : ""}{ok ? "" : " (added by an admin or the department head)"}
                    </option>
                  );
                })}
              </Select>
            </Field>
            <Field label="Project role" htmlFor="m-role">
              <Select id="m-role" value={chosenRole ?? ""} onChange={(e) => setRole(e.target.value as ProjectRole)}>
                {whoRoles.map((r) => <option key={r} value={r}>{r === "pm" ? "PM" : "Engineer"}</option>)}
              </Select>
            </Field>
            <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" pending={pending} disabled={!who || !chosenRole}>Add member</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
