import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
export const pct = (n: number | null | undefined, digits = 0) => (n == null ? "—" : `${Number(n).toFixed(digits)}%`);
export const num = (n: number | null | undefined) => (n == null ? "—" : String(n));
