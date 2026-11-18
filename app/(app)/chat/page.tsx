import { requireSession } from "@/lib/auth/session";
import { chatInbox } from "@/lib/data/chat";
import { isUuid } from "@/lib/chat";
import { ChatApp } from "@/components/chat/chat-app";

export const metadata = { title: "Project Chat · FSMB" };

/**
 * Project Chat: one group chat per project + private direct messages. Who may read what is decided by the database
 * (migration 29, RLS + Realtime + Storage policies); this page only shows what the caller's session can read.
 */
export default async function ChatPage({ searchParams }: { searchParams: Promise<{ c?: string; m?: string }> }) {
  const [s, sp, inbox] = await Promise.all([requireSession(), searchParams, chatInbox()]);
  return (
    <div className="-mx-4 -my-6 h-[calc(100dvh-3.5rem)] px-2 py-3 md:-mx-8 md:-my-8 md:px-6 md:py-5">
      <ChatApp me={{ id: s.userId, name: s.profile.full_name, isAdmin: s.isAdmin }} initialInbox={inbox}
        initialConversation={isUuid(sp.c) ? sp.c : null} initialMessage={isUuid(sp.m) ? sp.m : null} />
    </div>
  );
}
