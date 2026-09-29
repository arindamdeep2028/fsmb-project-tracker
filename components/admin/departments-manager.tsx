"use client";
import { useState } from "react";
import { deleteDepartment, saveDepartment, setDepartmentHead } from "@/lib/actions/admin";
import { useAction } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Badge } from "@/components/ui/misc";

type Dept = { id: string; name: string; sort_order: number; active: boolean };
type Head = { department_id: string; user_id: string; head: { full_name: string } | null };

export function DepartmentsManager({ departments, heads, candidates }: { departments: Dept[]; heads: Head[]; candidates: { id: string; full_name: string }[] }) {
  const { pending, run } = useAction();
  const [name, setName] = useState("");
  return (
    <div className="space-y-4">
      <ul className="divide-y divide-line-soft rounded-lg border border-line bg-panel">
        {departments.map((d) => <DeptRow key={d.id} d={d} heads={heads.filter((h) => h.department_id === d.id)} candidates={candidates} />)}
      </ul>
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); run(() => saveDepartment({ name, sort_order: departments.length + 1, active: true }), () => setName("")); }}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New department name" aria-label="New department name" className="max-w-xs" />
        <Button type="submit" pending={pending} disabled={!name.trim()}>Add department</Button>
      </form>
    </div>
  );
}

function DeptRow({ d, heads, candidates }: { d: Dept; heads: Head[]; candidates: { id: string; full_name: string }[] }) {
  const { pending, run } = useAction();
  const [name, setName] = useState(d.name);
  const [add, setAdd] = useState("");
  const available = candidates.filter((c) => !heads.some((h) => h.user_id === c.id));
  return (
    <li className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Department name" className="max-w-xs" />
        {!d.active ? <Badge signal="done">Inactive</Badge> : null}
        <Button size="sm" variant="secondary" pending={pending} disabled={name === d.name} onClick={() => run(() => saveDepartment({ ...d, name }))}>Rename</Button>
        <Button size="sm" variant="ghost" pending={pending} onClick={() => run(() => saveDepartment({ ...d, active: !d.active }))}>{d.active ? "Deactivate" : "Activate"}</Button>
        <Button size="sm" variant="ghost" className="text-signal-red" pending={pending} onClick={() => confirm(`Delete ${d.name}?`) && run(() => deleteDepartment(d.id))}>Delete</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-ink-soft">Heads:</span>
        {heads.length ? heads.map((h) => (
          <span key={h.user_id} className="inline-flex items-center gap-1 rounded bg-steel-wash px-2 py-0.5">{h.head?.full_name}
            <button aria-label={`Remove ${h.head?.full_name} as head`} className="text-ink-faint hover:text-signal-red" onClick={() => run(() => setDepartmentHead(d.id, h.user_id, false))}>×</button></span>
        )) : <span className="text-ink-faint">none</span>}
        {available.length ? (
          <>
            <Select value={add} onChange={(e) => setAdd(e.target.value)} aria-label="Add a head" className="h-8 w-52 text-sm"><option value="">Add a head</option>{available.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}</Select>
            <Button size="sm" variant="secondary" disabled={!add} pending={pending} onClick={() => run(() => setDepartmentHead(d.id, add, true), () => setAdd(""))}>Add</Button>
          </>
        ) : null}
      </div>
    </li>
  );
}
