"use client";
import { Button } from "@/components/ui/button";
import { dailyCsvLine, DAILY_HEAD, type DailyRow } from "@/lib/sheet";

/** CSV of the Daily Reports sheet in its column order (managers only, like every CSV export). */
export function DailyLogCsv({ rows, name }: { rows: DailyRow[]; name: string }) {
  function download() {
    const esc = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const body = rows.map((r) => dailyCsvLine(r).map(esc).join(","));
    const url = URL.createObjectURL(new Blob([`﻿${DAILY_HEAD.join(",")}\n${body.join("\n")}`], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `${name}.csv`; a.click(); URL.revokeObjectURL(url);
  }
  return <Button variant="secondary" size="sm" onClick={download}>Export CSV</Button>;
}
