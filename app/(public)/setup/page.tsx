import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { callEdge } from "@/lib/edge";
import { SetupForm } from "./setup-form";

export const metadata: Metadata = { title: "First-time setup" };

/**
 * Only while no active admin exists and first-time setup is switched on (the auth-admin function has its
 * SETUP_TOKEN secret); otherwise the route is a 404 (Frontend Blueprint §4). The form asks for that setup code.
 */
export default async function SetupPage() {
  const status = await callEdge<{ admin_exists: boolean; setup_enabled?: boolean }>("auth-admin", { action: "status" }, { asUser: false });
  if (!status.ok || status.data.admin_exists !== false || status.data.setup_enabled !== true) notFound();
  return (
    <>
      <h1 className="mb-1 text-2xl font-semibold">Set up FSMB Project Tracker</h1>
      <p className="mb-6 text-ink-soft">Create the first admin. You'll add departments and people next.</p>
      <SetupForm />
    </>
  );
}
