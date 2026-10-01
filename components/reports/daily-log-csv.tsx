"use client";
import { Button } from "@/components/ui/button";
import { sheetDate, weekday, type DailyRow } from "@/lib/sheet";

const HEAD = ["Day", "Date", "Day", "Main Task", "Daily Sub Task", "Assigned To", "Status", "Issues", "Next Task", "Remarks"];

/** CSV of the Daily Follow Up in the sheet's column order (managers only, like every CSV export). */
export function DailyLogCsv({ rows, name }: { rows: DailyRow[]; name: string }) {
  function download() {
    const esc = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const body = rows.map((r) => [
      r.dayNo ? `Day ${r.dayNo}` : "", sheetDate(r.date), weekday(r.date),
      r.mainTask.map((m) => (m.sub ? `${m.label} / ${m.sub}` : m.label)).join("\n"), r.dailySubTask, r.assignedTo,
      r.mainTask.map((m) => m.status ?? "").join("\n"), r.issues, r.nextTask, r.remarks,
    ].map(esc).join(","));
    const url = URL.createObjectURL(new Blob([`﻿${HEAD.join(",")}\n${body.join("\n")}`], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `${name}.csv`; a.click(); URL.revokeObjectURL(url);
  }
  return <Button variant="secondary" size="sm" onClick={download}>Export CSV</Button>;
}
