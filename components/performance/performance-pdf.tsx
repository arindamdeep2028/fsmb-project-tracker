"use client";
import { useState } from "react";
import { FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/toast";
import { breachLabel, scoreBand } from "@/lib/labels";
import { fmt, fmtDate } from "@/lib/time";
import type { PerformanceRecords, PerformanceSummary, PerformanceTask } from "@/lib/my-performance";

type Rgb = [number, number, number];
const FOREST: Rgb = [52, 72, 60];
const WASH: Rgb = [233, 239, 233];
const INK: Rgb = [38, 51, 43];
const SOFT: Rgb = [100, 117, 104];
const BAND: Record<string, Rgb> = { green: [46, 125, 85], amber: [183, 121, 31], red: [196, 48, 43], neutral: [100, 117, 104] };

/**
 * One person's performance report as a PDF (A4, made in the browser from the figures and records already on the
 * page, so it holds exactly what the Admin sees): header, the person and the window, the score and its figures,
 * then the records behind them — tasks assigned, completed (on time or late), red marks and daily updates.
 */
export function PerformancePdf({ person, identity, window, summary, records, weights }: {
  person: string; identity: string; window: { from: string; to: string };
  summary: PerformanceSummary; records: PerformanceRecords; weights: { onTime: number; clean: number };
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      const [{ jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const W = doc.internal.pageSize.getWidth();
      const M = 40;
      const band = scoreBand(summary.score);

      // header band
      doc.setFillColor(...FOREST); doc.rect(0, 0, W, 64, "F");
      doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(16);
      doc.text("Performance report", M, 30);
      doc.setFont("helvetica", "normal"); doc.setFontSize(10);
      doc.text("FSMB Project Tracker", M, 48);
      doc.text(`Generated ${fmt(new Date(), "d MMM yyyy, HH:mm")} (Dhaka)`, W - M, 48, { align: "right" });

      // person and window
      doc.setTextColor(...INK); doc.setFont("helvetica", "bold"); doc.setFontSize(18);
      doc.text(person, M, 98);
      doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(...SOFT);
      doc.text(identity, M, 116);
      doc.text(`Window: ${fmtDate(window.from)} to ${fmtDate(window.to)}`, M, 131);

      // score card
      const top = 150;
      doc.setFillColor(...WASH); doc.roundedRect(M, top, W - 2 * M, 64, 6, 6, "F");
      doc.setTextColor(...INK); doc.setFontSize(9); doc.text("SCORE", M + 16, top + 20);
      doc.setFont("helvetica", "bold"); doc.setFontSize(26); doc.text(summary.score == null ? "—" : String(summary.score), M + 16, top + 50);
      doc.setFontSize(11); doc.setTextColor(...BAND[band.signal]); doc.text(band.label, M + 80, top + 48);
      doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...SOFT);
      doc.text(`Weights: on time ${Math.round(weights.onTime * 100)}% · clean days ${Math.round(weights.clean * 100)}%`, W - M - 16, top + 20, { align: "right" });

      const head = { fillColor: FOREST, textColor: [255, 255, 255] as Rgb, fontStyle: "bold" as const, halign: "center" as const };
      const styles = { font: "helvetica", fontSize: 9, textColor: INK, lineColor: [201, 209, 203] as Rgb, lineWidth: 0.5, cellPadding: 5, valign: "middle" as const };
      autoTable(doc, {
        startY: top + 80, margin: { left: M, right: M }, theme: "grid", styles, headStyles: head,
        head: [["Tasks assigned", "Completed", "Completed late", "On time", "Red marks", "Daily updates"]],
        body: [[summary.assigned, summary.completed, summary.late, summary.on_time_pct == null ? "—" : `${Math.round(summary.on_time_pct)}%`, summary.red_events, summary.daily_updates]],
        bodyStyles: { halign: "center", fontStyle: "bold", fontSize: 11 },
      });

      const section = (title: string, count: number) => {
        let y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 26;
        if (y > doc.internal.pageSize.getHeight() - 90) { doc.addPage(); y = 50; }
        doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(...INK);
        doc.text(`${title} (${count})`, M, y);
        return y + 8;
      };
      const taskRows = (xs: PerformanceTask[], late: Set<string>) => xs.map((t) => [
        t.code, t.title, t.project_code ?? "", t.status, fmtDate(t.assigned_on), t.completed_on ? fmtDate(t.completed_on) : "—",
        t.effective_due_at ? fmtDate(t.effective_due_at) : "—", t.completed_on ? (late.has(t.id) ? "Late" : "On time") : "",
      ]);
      const late = new Set(records.late.map((t) => t.id));
      const table = (title: string, headRow: string[], body: (string | number)[][], widths?: Record<number, number>) => {
        const y = section(title, body.length);
        autoTable(doc, {
          startY: y, margin: { left: M, right: M }, theme: "grid", styles, headStyles: head,
          head: [headRow], body: body.length ? body : [[{ content: "None in this window.", colSpan: headRow.length, styles: { halign: "center", textColor: SOFT } }]] as never,
          alternateRowStyles: { fillColor: [247, 249, 247] },
          columnStyles: Object.fromEntries(Object.entries(widths ?? {}).map(([k, w]) => [k, { cellWidth: w }])),
          didParseCell: (d) => {
            if (d.section === "body" && headRow[d.column.index] === "Result") {
              if (d.cell.raw === "Late") { d.cell.styles.textColor = BAND.red; d.cell.styles.fontStyle = "bold"; }
              if (d.cell.raw === "On time") { d.cell.styles.textColor = BAND.green; d.cell.styles.fontStyle = "bold"; }
            }
          },
        });
      };
      const taskHead = ["Code", "Task", "Project", "Status", "Assigned", "Completed", "Due", "Result"];
      const taskW = { 0: 58, 2: 46, 3: 60, 4: 58, 5: 58, 6: 58, 7: 44 };
      table("Tasks completed", taskHead, taskRows(records.completed, late), taskW);
      table("Tasks assigned", taskHead, taskRows(records.assigned, late), taskW);
      table("Red marks", ["Date", "Project", "Task", "Reason", "Details"], records.red.map((r) => [
        fmtDate(r.log_date), r.project_code ?? "", [r.task_code, r.task_title].filter(Boolean).join(" "), r.reason_code ? breachLabel[r.reason_code] : "", r.details ?? "",
      ]), { 0: 62, 1: 50 });
      table("Daily updates", ["Date", "Project", "Task", "Details"], records.daily.map((r) => [
        fmtDate(r.log_date), r.project_code ?? "", [r.task_code, r.task_title].filter(Boolean).join(" "), r.details ?? "",
      ]), { 0: 62, 1: 50 });

      // footer on every page
      const pages = doc.getNumberOfPages();
      for (let i = 1; i <= pages; i++) {
        doc.setPage(i);
        const H = doc.internal.pageSize.getHeight();
        doc.setDrawColor(221, 229, 222); doc.line(M, H - 34, W - M, H - 34);
        doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...SOFT);
        doc.text(`${person} · ${fmtDate(window.from)} – ${fmtDate(window.to)}`, M, H - 20);
        doc.text(`Page ${i} of ${pages}`, W - M, H - 20, { align: "right" });
      }
      doc.save(`performance-${person.replace(/[^\w-]+/g, "-")}-${window.from}-to-${window.to}.pdf`);
    } catch {
      toast({ ok: false, message: "The PDF couldn't be made. Try again." });
    } finally { setBusy(false); }
  }

  return <Button variant="secondary" size="sm" onClick={download} pending={busy} data-testid="performance-pdf"><FileDown size={16} className="mr-1" />Download PDF</Button>;
}
