import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { formatDistanceToNowStrict } from "date-fns";

/** All display is in Dhaka time; "today" is the Dhaka date (Frontend Blueprint rule 5). */
export const TZ = "Asia/Dhaka";

export function fmt(ts: string | Date | null | undefined, pattern = "dd MMM, HH:mm"): string {
  if (!ts) return "—";
  return formatInTimeZone(typeof ts === "string" ? new Date(ts) : ts, TZ, pattern);
}
export const fmtDate = (d: string | null | undefined) => (d ? fmt(d.length === 10 ? `${d}T12:00:00+06:00` : d, "dd MMM yyyy") : "—");
export const fmtDay = (d: string | null | undefined) => (d ? fmt(d.length === 10 ? `${d}T12:00:00+06:00` : d, "EEE dd MMM") : "—");

export function dhakaToday(): string {
  return formatInTimeZone(new Date(), TZ, "yyyy-MM-dd");
}
export function dhakaHour(): number {
  return Number(formatInTimeZone(new Date(), TZ, "H"));
}
export function ago(ts: string | null | undefined): string {
  if (!ts) return "";
  return `${formatDistanceToNowStrict(new Date(ts))} ago`;
}
/** Value for <input type="datetime-local"> from a UTC timestamp, in Dhaka time. */
export function toLocalInput(ts: string | null | undefined): string {
  return ts ? formatInTimeZone(new Date(ts), TZ, "yyyy-MM-dd'T'HH:mm") : "";
}
/** Dhaka wall-clock "yyyy-MM-ddTHH:mm" from a form → ISO UTC string for the database. */
export function fromLocalInput(v: string): string {
  return fromZonedTime(v, TZ).toISOString();
}
export function daysAgo(n: number): string {
  const d = new Date(Date.now() - n * 864e5);
  return formatInTimeZone(d, TZ, "yyyy-MM-dd");
}
