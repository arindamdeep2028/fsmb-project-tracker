"use client";
import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/toast";
import { DAILY_HEAD, DAILY_WIDTHS, dailyExcelLine, type DailyRow, type DayRemark } from "@/lib/sheet";
import { downloadXlsx, type XCol, type XKind } from "@/lib/xlsx";

const KINDS: (XKind | undefined)[] = ["text", "text", "text", "text", "text", "hours", "status", "text", "text", "number", "text"];
const ALIGN: XCol["align"][] = ["center", "center", "center", "left", "center", "center", "center", "left", "left", "center", "left"];

/** The Daily Reports sheet as a formatted Excel file, in its column order (managers only, like every export). */
export function DailyLogExcel({ rows, remarks = [], name, title }: { rows: DailyRow[]; remarks?: DayRemark[]; name: string; title: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function download() {
    setBusy(true);
    try {
      await downloadXlsx(name, [{
        name: "Daily reports", title,
        columns: DAILY_HEAD.map((header, i) => ({ header, width: DAILY_WIDTHS[i], kind: KINDS[i], align: ALIGN[i] })),
        rows: rows.map((r) => dailyExcelLine(r, remarks)),
        rowStyle: (i) => (rows[i]?.offDay ? { fill: "#9c4a14", color: "#ffffff" } : undefined),
        columnFill: [undefined, "#e9e1cc"],
      }]);
    } catch {
      toast({ ok: false, message: "The Excel file couldn't be made. Try again." });
    } finally { setBusy(false); }
  }
  return <Button variant="secondary" size="sm" onClick={download} pending={busy}><Download size={16} className="mr-1" />Export Excel</Button>;
}
