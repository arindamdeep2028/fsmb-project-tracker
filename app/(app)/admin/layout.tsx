import { requireAdmin } from "@/lib/auth/session";

/** Every /admin page: live profile must be an active Admin (layer 2); RLS and the admin RPC checks are layer 3. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return <>{children}</>;
}
