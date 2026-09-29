import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { getPreferences } from "@/lib/data/notifications";
import { roleLabel } from "@/lib/labels";
import { PageHeader, Section } from "@/components/ui/misc";
import { NameForm } from "@/components/name-form";
import { PreferencesForm } from "@/components/notifications/preferences-form";

export const metadata: Metadata = { title: "My account" };

export default async function SettingsPage() {
  const s = await requireSession();
  const prefs = await getPreferences(s.userId);
  return (
    <>
      <PageHeader title="My account" lead="Your role and department are set by an admin." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Profile">
          <dl className="mb-5 grid grid-cols-[8rem_minmax(0,1fr)] gap-y-2 text-[15px]">
            <dt className="text-ink-soft">Login name</dt><dd>{s.profile.login_name}</dd>
            <dt className="text-ink-soft">Email</dt><dd>{s.profile.email ?? s.email}</dd>
            <dt className="text-ink-soft">Role</dt><dd>{roleLabel[s.profile.role]}</dd>
          </dl>
          <NameForm name={s.profile.full_name} />
          <Link href="/change-password" className="mt-5 inline-block text-sm font-medium text-steel hover:underline">Change password</Link>
        </Section>
        <Section title="Notifications"><PreferencesForm initial={prefs} /></Section>
      </div>
    </>
  );
}
