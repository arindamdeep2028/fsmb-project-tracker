"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronDown, ChevronUp, Info, Loader2, MessageSquarePlus, Search, UserMinus, UserPlus, Users, X } from "lucide-react";
import { getBrowserClient } from "@/lib/supabase/browser";
import { sendChatWithFiles, deleteChatMessage } from "@/lib/actions/chat";
import { describeError } from "@/lib/errors";
import { dayLabel, listTime, plainBody, sameDay } from "@/lib/chat";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/utils";
import { Avatar, roleText } from "./bits";
import { Composer, type SendPayload } from "./composer";
import { MessageItem, type Receipt } from "./message-item";
import type { Attachment, Candidate, InboxRow, Me, MemberEvent, MessageRow, PersonRow } from "./types";

const PAGE = 50;
type Tab = "project" | "direct";

function normalise(r: Record<string, unknown>): MessageRow {
  return { ...(r as unknown as MessageRow), attachments: (Array.isArray(r.attachments) ? r.attachments : []) as Attachment[], mention_ids: (r.mention_ids as string[]) ?? [] };
}
const title = (c: InboxRow) => (c.kind === "project" ? `${c.project_code} · ${c.project_name}`
  : !c.is_participant && c.participant_names ? c.participant_names : c.other_name ?? "Former member");

function preview(c: InboxRow, meId: string): string {
  if (!c.last_message_at) return c.kind === "project" ? "No messages yet" : "Say hello";
  const who = c.last_sender_id === meId ? "You" : (c.last_sender_name ?? "").split(" ")[0];
  const text = c.last_deleted ? "Message deleted" : plainBody(c.last_body ?? "") || (c.last_has_files ? "📎 File" : "");
  return (c.kind === "project" || !c.is_participant) && who ? `${who}: ${text}` : c.last_sender_id === meId ? `You: ${text}` : text;
}

export function ChatApp({ me, initialInbox, initialConversation, initialMessage }: {
  me: Me; initialInbox: InboxRow[]; initialConversation: string | null; initialMessage: string | null;
}) {
  const supabase = getBrowserClient();
  const toast = useToast();
  const router = useRouter();
  const [inbox, setInbox] = useState<InboxRow[]>(initialInbox);
  const startConv = initialInbox.find((c) => c.id === initialConversation) ?? null;
  const [tab, setTab] = useState<Tab>(startConv?.kind ?? "project");
  const [activeId, setActiveId] = useState<string | null>(startConv?.id ?? (initialInbox.find((c) => c.kind === "project")?.id ?? null));
  const [mobileView, setMobileView] = useState<"list" | "chat">(startConv ? "chat" : "list");
  const [search, setSearch] = useState("");
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [events, setEvents] = useState<MemberEvent[]>([]);
  const [replyTo, setReplyTo] = useState<MessageRow | null>(null);
  const [editing, setEditing] = useState<MessageRow | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [online, setOnline] = useState<Set<string>>(new Set());
  // the info panel sits beside the chat on wide screens; on smaller screens it is an overlay opened on demand
  const [showInfo, setShowInfo] = useState(false);
  useEffect(() => { if (window.matchMedia("(min-width: 1280px)").matches) setShowInfo(true); }, []);
  const [showAllMembers, setShowAllMembers] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [lost, setLost] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(null);

  const scroller = useRef<HTMLDivElement>(null);
  const timeline = useRef<HTMLDivElement>(null);
  // Content that grows after it is shown (image previews, late rows) keeps the view on the newest message, as long as
  // the reader was already at the bottom.
  useEffect(() => {
    const el = scroller.current, inner = timeline.current;
    if (!el || !inner || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => { if (atBottom.current) el.scrollTop = el.scrollHeight; });
    ro.observe(inner);
    return () => ro.disconnect();
  });
  const activeRef = useRef(activeId); activeRef.current = activeId;
  const messagesRef = useRef(messages); messagesRef.current = messages;
  const atBottom = useRef(true);
  const pendingJump = useRef<string | null>(initialMessage);

  const active = inbox.find((c) => c.id === activeId) ?? null;
  const peopleMap = useMemo(() => new Map(people.map((p) => [p.user_id, p])), [people]);
  const meRow = peopleMap.get(me.id);

  // ---------------------------------------------------------------- data
  const reloadInbox = useCallback(async () => {
    const { data } = await supabase.rpc("chat_inbox");
    if (data) setInbox(data);
    return data ?? [];
  }, [supabase]);

  const refreshBadge = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markRead = useCallback((conv: string) => {
    if (document.visibilityState !== "visible") return;
    setInbox((xs) => xs.map((c) => (c.id === conv ? { ...c, unread: 0, mentions: 0 } : c)));
    void supabase.rpc("mark_chat_read", { p_conv: conv }).then(() => {
      if (refreshBadge.current) clearTimeout(refreshBadge.current);
      refreshBadge.current = setTimeout(() => router.refresh(), 600);   // sidebar badge + bell
    });
  }, [supabase, router]);

  const scrollToBottom = (smooth = false) => requestAnimationFrame(() => {
    const el = scroller.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  });

  const peopleLoadedAt = useRef(0);
  const loadPeople = useCallback(async (conv: string) => {
    peopleLoadedAt.current = Date.now();
    const [p, e] = await Promise.all([supabase.rpc("chat_people", { p_conv: conv }), supabase.rpc("chat_member_events", { p_conv: conv })]);
    if (activeRef.current !== conv) return;
    setPeople(p.data ?? []); setEvents(e.data ?? []);
  }, [supabase]);
  /** The @mention list opened: make sure it reflects the current project membership (at most every 5 s). */
  const refreshPeopleSoon = useCallback(() => {
    if (activeRef.current && Date.now() - peopleLoadedAt.current > 5000) void loadPeople(activeRef.current);
  }, [loadPeople]);
  const activeProjectRef = useRef<string | null>(null);
  activeProjectRef.current = inbox.find((c) => c.id === activeId)?.project_id ?? null;

  const fetchRows = useCallback(async (conv: string, before?: string) => {
    const { data, error } = await supabase.rpc("chat_message_rows", { p_conv: conv, p_limit: PAGE, ...(before ? { p_before: before } : {}) });
    if (error) return null;
    return (data ?? []).map((r) => normalise(r as unknown as Record<string, unknown>)).reverse();
  }, [supabase]);

  useEffect(() => {
    if (!activeId) return;
    let live = true;
    setLoading(true); setMessages([]); setPeople([]); setEvents([]); setReplyTo(null); setEditing(null); setHasMore(false); setLost(null); setShowAllMembers(false);
    void (async () => {
      const [rows] = await Promise.all([fetchRows(activeId), loadPeople(activeId)]);
      if (!live) return;
      setLoading(false);
      if (!rows) { setLost("You no longer have access to this conversation."); return; }
      setMessages(rows); setHasMore(rows.length === PAGE);
      atBottom.current = true; scrollToBottom();
      markRead(activeId);
      if (pendingJump.current) { const id = pendingJump.current; pendingJump.current = null; setTimeout(() => void jumpTo(id), 50); }
    })();
    const url = new URL(window.location.href);
    url.searchParams.set("c", activeId); url.searchParams.delete("m");
    window.history.replaceState(null, "", url.toString());
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const loadOlder = useCallback(async () => {
    const conv = activeRef.current; const first = messagesRef.current[0];
    if (!conv || !first || loadingOlder) return 0;
    setLoadingOlder(true);
    const el = scroller.current; const before = el?.scrollHeight ?? 0;
    const rows = await fetchRows(conv, first.created_at);
    setLoadingOlder(false);
    if (!rows || activeRef.current !== conv) return 0;
    setMessages((xs) => [...rows.filter((r) => !xs.some((x) => x.id === r.id)), ...xs]);
    setHasMore(rows.length === PAGE);
    requestAnimationFrame(() => { if (el) el.scrollTop += el.scrollHeight - before; });
    return rows.length;
  }, [fetchRows, loadingOlder]);

  /** Scroll to a message, loading earlier pages until it is there (when it still exists). */
  const jumpTo = useCallback(async (id: string) => {
    for (let i = 0; i < 40 && !messagesRef.current.some((m) => m.id === id); i++) {
      const conv = activeRef.current; const first = messagesRef.current[0];
      if (!conv || !first) break;
      const rows = await fetchRows(conv, first.created_at);
      if (!rows || !rows.length) break;
      messagesRef.current = [...rows, ...messagesRef.current];
      setMessages(messagesRef.current); setHasMore(rows.length === PAGE);
    }
    requestAnimationFrame(() => {
      const el = document.getElementById(`msg-${id}`);
      if (!el) { toast({ ok: false, message: "The original message is no longer available." }); return; }
      atBottom.current = false;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlight(id); setTimeout(() => setHighlight((h) => (h === id ? null : h)), 2200);
    });
  }, [fetchRows, toast]);

  // ---------------------------------------------------------------- realtime + presence
  /** Catch up after a Realtime gap (reconnect, server restart, sleeping laptop): newest messages, inbox, members. */
  const catchUp = useCallback(async () => {
    const conv = activeRef.current;
    void reloadInbox().then((rows) => {
      if (conv && rows.length && !rows.some((c) => c.id === conv)) setLost("You no longer have access to this conversation.");
    });
    if (!conv) return;
    const rows = await fetchRows(conv);
    if (!rows || activeRef.current !== conv) return;
    let added = false;
    setMessages((xs) => {
      const byId = new Map(rows.map((r) => [r.id, r]));
      const known = new Set(xs.map((x) => x.id));
      const fresh = rows.filter((r) => !known.has(r.id));
      const updated = xs.map((x) => { const r = byId.get(x.id); return r && (r.deleted !== x.deleted || r.edited_at !== x.edited_at) ? r : x; });
      if (!fresh.length) return updated;
      added = true;
      return [...updated.filter((x) => !(x.pending && fresh.some((f) => f.sender_id === x.sender_id && f.body === x.body))), ...fresh]
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
    });
    if (added) { if (atBottom.current) scrollToBottom(true); markRead(conv); }
    void loadPeople(conv);
  }, [reloadInbox, fetchRows, markRead, loadPeople]);
  const catchUpRef = useRef(catchUp); catchUpRef.current = catchUp;

  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") void catchUpRef.current(); }, 20_000);
    return () => clearInterval(t);
  }, []);

  const inboxTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const softReloadInbox = useCallback(() => {
    if (inboxTimer.current) clearTimeout(inboxTimer.current);
    inboxTimer.current = setTimeout(() => void reloadInbox(), 350);
  }, [reloadInbox]);

  useEffect(() => {
    // Join only once the signed-in token is attached: a channel that joins with the bare anon key is checked against
    // RLS as anonymous and receives nothing.
    let cancelled = false;
    let joinedOnce = false;
    let ch: ReturnType<typeof supabase.channel> | null = null;
    let presence: ReturnType<typeof supabase.channel> | null = null;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void reloadInbox().then((rows) => {
        if (activeRef.current && !rows.some((c) => c.id === activeRef.current)) setLost("You no longer have access to this conversation.");
      });
      if (activeRef.current) markRead(activeRef.current);
    };
    document.addEventListener("visibilitychange", onVisible);
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) await supabase.realtime.setAuth(data.session.access_token);
      if (cancelled) return;
    ch = supabase.channel(`chat:${me.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, async (payload) => {
        const row = payload.new as { id: string; conversation_id: string; sender_id: string | null };
        if (row.conversation_id === activeRef.current) {
          const { data } = await supabase.rpc("chat_message_rows", { p_conv: row.conversation_id, p_id: row.id, p_limit: 1 });
          const m = data?.[0] ? normalise(data[0] as unknown as Record<string, unknown>) : null;
          if (m && row.conversation_id === activeRef.current) {
            setMessages((xs) => (xs.some((x) => x.id === m.id) ? xs : [...xs.filter((x) => !(x.pending && x.sender_id === m.sender_id && x.body === m.body)), m]));
            if (atBottom.current || row.sender_id === me.id) scrollToBottom(true);
            if (row.sender_id !== me.id) markRead(row.conversation_id);
          }
        }
        softReloadInbox();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_messages" }, async (payload) => {
        const row = payload.new as { id: string; conversation_id: string; deleted_at: string | null; edited_at: string | null };
        if (row.deleted_at && row.conversation_id === activeRef.current) {
          setMessages((xs) => xs.map((x) => (x.id === row.id ? { ...x, deleted: true, body: "", attachments: [], edited_at: null } : x.reply_to_id === row.id ? { ...x, reply_deleted: true, reply_body: "" } : x)));
          setEditing((e) => (e?.id === row.id ? null : e));
        } else if (row.edited_at && row.conversation_id === activeRef.current) {
          const { data } = await supabase.rpc("chat_message_rows", { p_conv: row.conversation_id, p_id: row.id, p_limit: 1 });
          const m = data?.[0] ? normalise(data[0] as unknown as Record<string, unknown>) : null;
          if (m) setMessages((xs) => xs.map((x) => (x.id === m.id ? m : x.reply_to_id === m.id ? { ...x, reply_body: m.body.slice(0, 300) } : x)));
        }
        softReloadInbox();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_participants" }, (payload) => {
        const row = payload.new as { conversation_id: string; user_id: string; last_read_at: string | null };
        if (row?.conversation_id === activeRef.current) {
          setPeople((ps) => ps.map((p) => (p.user_id === row.user_id ? { ...p, last_read_at: row.last_read_at } : p)));
        }
      })
      // someone joined or left a project: the open chat's members and @mention list follow at once
      .on("postgres_changes", { event: "*", schema: "public", table: "project_member_periods" }, (payload) => {
        const row = (payload.new ?? {}) as { project_id?: string };
        if (activeRef.current && row.project_id && row.project_id === activeProjectRef.current) void loadPeople(activeRef.current);
        softReloadInbox();
      })
      .subscribe((status) => {
        // a re-join after a dropped connection: fetch whatever arrived while the channel was down
        if (status === "SUBSCRIBED") { if (joinedOnce) void catchUpRef.current(); joinedOnce = true; }
      });
    const pres = supabase.channel("chat-online", { config: { presence: { key: me.id } } });
    presence = pres;
    pres.on("presence", { event: "sync" }, () => setOnline(new Set(Object.keys(pres.presenceState()))))
      .subscribe((s) => { if (s === "SUBSCRIBED") void pres.track({ at: Date.now() }); });
    })();
    return () => {
      cancelled = true;
      if (ch) void supabase.removeChannel(ch);
      if (presence) void supabase.removeChannel(presence);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [supabase, me.id, markRead, reloadInbox, softReloadInbox, loadPeople]);

  // ---------------------------------------------------------------- actions
  const send = useCallback(async (p: SendPayload): Promise<boolean> => {
    const conv = activeRef.current; if (!conv) return false;
    const tmpId = `tmp-${crypto.randomUUID()}`;
    const reply = replyTo;
    if (!p.attachments.length) {
      const tmp: MessageRow = {
        id: tmpId, conversation_id: conv, sender_id: me.id, sender_name: me.name, sender_role: null, body: p.body,
        created_at: new Date().toISOString(), deleted: false, reply_to_id: reply?.id ?? null, reply_sender_id: reply?.sender_id ?? null,
        reply_sender_name: reply?.sender_name ?? null, reply_body: reply?.body ?? null, reply_deleted: false, attachments: [], mention_ids: [], edited_at: null, pending: true,
      };
      setMessages((xs) => [...xs, tmp]); atBottom.current = true; scrollToBottom(true);
    }
    setReplyTo(null);
    let id: string | null = null; let message: string | null = null;
    if (p.attachments.length) {
      const r = await sendChatWithFiles({ conversation_id: conv, body: p.body, reply_to_id: reply?.id ?? null, attachments: p.attachments });
      if (r.ok) id = r.data?.id ?? null; else message = r.message;
    } else {
      const { data, error } = await supabase.rpc("send_chat_message", { p: { conversation_id: conv, body: p.body, reply_to_id: reply?.id ?? null } });
      if (error) message = describeError(error); else id = data;
    }
    if (!id) {
      setMessages((xs) => xs.filter((x) => x.id !== tmpId));
      setReplyTo(reply);
      toast({ ok: false, message: message ?? "The message wasn't sent. Try again." });
      if (/permission|access/i.test(message ?? "")) void reloadInbox().then((rows) => { if (!rows.some((c) => c.id === conv)) setLost("You no longer have access to this conversation."); });
      return false;
    }
    const { data } = await supabase.rpc("chat_message_rows", { p_conv: conv, p_id: id, p_limit: 1 });
    const real = data?.[0] ? normalise(data[0] as unknown as Record<string, unknown>) : null;
    if (activeRef.current === conv) {
      setMessages((xs) => {
        const rest = xs.filter((x) => x.id !== tmpId && x.id !== id);
        return real ? [...rest, real].sort((a, b) => a.created_at.localeCompare(b.created_at)) : rest;
      });
      scrollToBottom(true);
    }
    softReloadInbox();
    return true;
  }, [replyTo, me.id, me.name, supabase, toast, reloadInbox, softReloadInbox]);

  const onEdit = useCallback((m: MessageRow) => { setReplyTo(null); setEditing(m); }, []);
  const saveEdit = useCallback(async (body: string): Promise<boolean> => {
    const target = editing; if (!target) return false;
    if (body === target.body) { setEditing(null); return true; }
    const { error } = await supabase.rpc("edit_chat_message", { p_id: target.id, p_body: body });
    if (error) { toast({ ok: false, message: describeError(error) }); return false; }
    const { data } = await supabase.rpc("chat_message_rows", { p_conv: target.conversation_id, p_id: target.id, p_limit: 1 });
    const m = data?.[0] ? normalise(data[0] as unknown as Record<string, unknown>) : null;
    if (m) setMessages((xs) => xs.map((x) => (x.id === m.id ? m : x.reply_to_id === m.id ? { ...x, reply_body: m.body.slice(0, 300) } : x)));
    setEditing(null);
    softReloadInbox();
    return true;
  }, [editing, supabase, toast, softReloadInbox]);

  const onDelete = useCallback(async (id: string) => {
    if (!window.confirm("Delete this message for everyone?")) return;
    const r = await deleteChatMessage(id);
    toast({ ok: r.ok, message: r.message });
    if (r.ok) {
      setMessages((xs) => xs.map((x) => (x.id === id ? { ...x, deleted: true, body: "", attachments: [], edited_at: null } : x)));
      setEditing((e) => (e?.id === id ? null : e));
    }
  }, [toast]);

  const openDirect = useCallback(async (userId: string) => {
    const { data, error } = await supabase.rpc("start_direct_chat", { p_other: userId });
    if (error || !data) { toast({ ok: false, message: describeError(error) }); return; }
    await reloadInbox();
    setTab("direct"); setPicking(false); setActiveId(data); setMobileView("chat");
  }, [supabase, toast, reloadInbox]);

  useEffect(() => {
    if (tab === "direct" && candidates === null) void supabase.rpc("chat_dm_candidates").then(({ data }) => setCandidates(data ?? []));
  }, [tab, candidates, supabase]);

  // ---------------------------------------------------------------- derived
  const list = inbox.filter((c) => c.kind === tab).filter((c) => !search.trim() || title(c).toLowerCase().includes(search.trim().toLowerCase()));
  const unreadProject = inbox.filter((c) => c.kind === "project").reduce((n, c) => n + c.unread, 0);
  const unreadDirect = inbox.filter((c) => c.kind === "direct").reduce((n, c) => n + c.unread, 0);
  const others = people.filter((p) => p.user_id !== me.id);
  const membersOnly = others.filter((p) => p.access === "member" || p.access === "pm");
  /** current project members (PMs + engineers); Admins / the department head have access but are not members */
  const projectMemberCount = people.filter((p) => p.access === "member" || p.access === "pm").length;
  const myJoin = active?.kind === "project" && meRow?.joined_at && (meRow.access === "member" || meRow.access === "pm") ? meRow.joined_at : null;

  const receiptFor = useCallback((m: MessageRow): Receipt => {
    if (m.sender_id !== me.id || m.pending) return null;
    const audience = active?.kind === "direct" ? others : membersOnly.length ? membersOnly : others;
    const seen = others.filter((p) => p.last_read_at && p.last_read_at >= m.created_at).map((p) => p.full_name);
    return { seenBy: seen, total: Math.max(audience.length, 1) };
  }, [me.id, active?.kind, others, membersOnly]);

  type Item = { kind: "day"; key: string; label: string } | { kind: "msg"; m: MessageRow; grouped: boolean } | { kind: "event"; key: string; text: string; join: boolean };
  const items = useMemo(() => {
    const out: Item[] = [];
    const from = hasMore && messages[0] ? messages[0].created_at : "";
    const evs = events.flatMap((e) => [
      { at: e.joined_at, text: `${e.user_id === me.id ? "You" : e.full_name} joined the project`, join: true, key: `j-${e.user_id}-${e.joined_at}` },
      ...(e.left_at ? [{ at: e.left_at, text: `${e.user_id === me.id ? "You" : e.full_name} left the project`, join: false, key: `l-${e.user_id}-${e.left_at}` }] : []),
    ]).filter((e) => e.at >= from && (messages.length === 0 || e.at >= (hasMore ? from : messages[0].created_at)));
    const stream = [
      ...messages.map((m) => ({ at: m.created_at, m })),
      ...evs.map((e) => ({ at: e.at, e })),
    ].sort((a, b) => a.at.localeCompare(b.at));
    let prev: { at: string; sender: string | null; isMsg: boolean } | null = null;
    for (const s of stream) {
      if (!prev || !sameDay(prev.at, s.at)) out.push({ kind: "day", key: `d-${s.at}`, label: dayLabel(s.at) });
      if ("m" in s) {
        const grouped = !!prev && prev.isMsg && prev.sender === s.m.sender_id && sameDay(prev.at, s.at)
          && new Date(s.at).getTime() - new Date(prev.at).getTime() < 5 * 60 * 1000 && !s.m.reply_to_id;
        out.push({ kind: "msg", m: s.m, grouped });
        prev = { at: s.at, sender: s.m.sender_id, isMsg: true };
      } else {
        out.push({ kind: "event", key: s.e.key, text: s.e.text, join: s.e.join });
        prev = { at: s.at, sender: null, isMsg: false };
      }
    }
    return out;
  }, [messages, events, hasMore, me.id]);

  const select = (id: string) => { setActiveId(id); setMobileView("chat"); setPicking(false); };

  // ---------------------------------------------------------------- render
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-lg bg-steel-wash text-steel"><Users size={20} /></span>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold leading-tight md:text-2xl">Project Chat</h1>
          <p className="truncate text-sm text-ink-soft">{active ? (active.kind === "project" ? `Team communication for ${title(active)}` : !active.is_participant ? `Direct messages between ${title(active)} (Admin view)` : `Direct messages with ${active.other_name ?? "a former member"}`) : "Team communication for your projects"}</p>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 overflow-hidden rounded-xl border border-line bg-panel md:grid-cols-[19rem_minmax(0,1fr)] xl:grid-cols-[19rem_minmax(0,1fr)_auto]">
        {/* ------------------------------------------------ conversation list */}
        <aside className={cn("flex min-h-0 flex-col border-r border-line", mobileView === "chat" && "max-md:hidden")} aria-label="Conversations">
          <div className="p-3 pb-2">
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-paper p-1" role="tablist">
              {(["project", "direct"] as const).map((t) => (
                <button key={t} role="tab" aria-selected={tab === t} onClick={() => { setTab(t); setPicking(false); }} data-testid={`tab-${t}`}
                  className={cn("flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium", tab === t ? "bg-steel-wash text-steel shadow-sm" : "text-ink-soft hover:text-ink")}>
                  {t === "project" ? "Project Chats" : "Direct Messages"}
                  {(t === "project" ? unreadProject : unreadDirect) > 0 ? <span className="h-2 w-2 rounded-full bg-signal-red" aria-label="unread" /> : null}
                </button>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-line px-2.5 focus-within:border-steel">
              <Search size={16} className="text-ink-faint" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tab === "project" ? "Search project…" : "Search people…"}
                aria-label="Search conversations" className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none" />
            </div>
            {tab === "direct" ? (
              <button type="button" onClick={() => setPicking((v) => !v)} data-testid="new-dm"
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-line py-1.5 text-sm text-steel hover:border-steel">
                <MessageSquarePlus size={16} /> New direct message
              </button>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pb-2">
            {tab === "direct" && picking ? (
              <ul aria-label="People you can message">
                {candidates === null ? <li className="px-4 py-3 text-sm text-ink-faint">Loading…</li> : null}
                {(candidates ?? []).filter((c) => !search.trim() || c.full_name.toLowerCase().includes(search.trim().toLowerCase())).map((c) => (
                  <li key={c.user_id}>
                    <button type="button" onClick={() => void openDirect(c.user_id)} data-testid="dm-candidate"
                      className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-paper">
                      <Avatar id={c.user_id} name={c.full_name} size={34} online={online.has(c.user_id)} />
                      <span className="min-w-0"><span className="block truncate text-sm font-medium">{c.full_name}</span>
                        <span className="block truncate text-xs text-ink-soft">{c.role === "admin" ? "Admin" : c.role === "dept_head" ? "Department Head" : c.role === "pm" ? "Project Manager" : "Engineer"}{c.department ? ` · ${c.department}` : ""}</span></span>
                    </button>
                  </li>
                ))}
                {candidates?.length === 0 ? <li className="px-4 py-3 text-sm text-ink-faint">Nobody to message yet. You can message people who share a project or a department with you.</li> : null}
              </ul>
            ) : (
              <ul aria-label={tab === "project" ? "Project chats" : "Direct messages"}>
                {list.map((c) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => select(c.id)} data-testid="conversation" data-conversation-id={c.id} aria-current={c.id === activeId ? "true" : undefined}
                      className={cn("flex w-full items-start gap-3 border-l-4 px-3 py-2.5 text-left", c.id === activeId ? "border-steel bg-steel-wash" : "border-transparent hover:bg-paper")}>
                      {c.kind === "project" || !c.is_participant ? (
                        <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-full", c.id === activeId ? "bg-steel text-white" : "bg-steel-wash text-steel")}><Users size={18} /></span>
                      ) : <Avatar id={c.other_user_id} name={c.other_name} size={40} online={!!c.other_user_id && online.has(c.other_user_id)} />}
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className={cn("min-w-0 flex-1 truncate text-sm", c.unread ? "font-semibold" : "font-medium")}>{title(c)}</span>
                          <span className="shrink-0 text-xs text-ink-faint">{listTime(c.last_message_at)}</span>
                        </span>
                        <span className="flex items-center gap-2">
                          <span className={cn("min-w-0 flex-1 truncate text-xs", c.unread ? "text-ink" : "text-ink-soft")}>{preview(c, me.id)}</span>
                          {c.mentions > 0 ? <span className="shrink-0 text-xs font-bold text-signal-red" aria-label="You were mentioned">@</span> : null}
                          {c.unread > 0 ? <span data-testid="unread-badge" className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-signal-green px-1.5 text-[11px] font-semibold text-white">{c.unread > 99 ? "99+" : c.unread}</span> : null}
                        </span>
                        {c.project_archived ? <span className="text-[11px] text-ink-faint">Archived project · read only</span> : null}
                      </span>
                    </button>
                  </li>
                ))}
                {list.length === 0 ? (
                  <li className="px-4 py-6 text-center text-sm text-ink-faint">
                    {tab === "project" ? "You aren't on any project yet. Project chats appear here when you are added to a project." : "No direct messages yet."}
                  </li>
                ) : null}
              </ul>
            )}
          </div>
        </aside>

        {/* ------------------------------------------------ chat window */}
        <section className={cn("flex min-h-0 min-w-0 flex-col", mobileView === "list" && "max-md:hidden")} aria-label="Conversation">
          {!active || lost ? (
            <div className="grid flex-1 place-items-center p-6 text-center text-sm text-ink-soft">
              <div>
                <p>{lost ?? "Choose a conversation."}</p>
                <button type="button" onClick={() => { setMobileView("list"); setLost(null); setActiveId(null); }} className="mt-3 text-steel underline md:hidden">Back to conversations</button>
              </div>
            </div>
          ) : (
            <>
              <header className="flex items-center gap-3 border-b border-line px-3 py-2.5 md:px-4">
                <button type="button" onClick={() => setMobileView("list")} className="rounded p-1 text-ink-soft md:hidden" aria-label="Back to conversations"><ArrowLeft size={20} /></button>
                {active.kind === "project" || !active.is_participant ? <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-steel text-white"><Users size={18} /></span>
                  : <Avatar id={active.other_user_id} name={active.other_name} size={40} online={!!active.other_user_id && online.has(active.other_user_id)} />}
                <div className="min-w-0 flex-1">
                  <h2 className="truncate font-semibold" data-testid="chat-title">{title(active)}</h2>
                  <p className="truncate text-xs text-ink-soft">
                    {active.kind === "project" ? (people.length ? `${projectMemberCount} members · Project Chat` : "Project Chat")
                      : !active.is_participant ? "Direct message · Admin view (read only)"
                      : online.has(active.other_user_id ?? "") ? "Online" : "Direct message"}
                  </p>
                </div>
                <button type="button" onClick={() => setShowInfo((v) => !v)} aria-pressed={showInfo} data-testid="info-toggle"
                  className="grid h-9 w-9 place-items-center rounded-md border border-line text-ink-soft hover:border-steel hover:text-steel" aria-label="Conversation info"><Info size={18} /></button>
              </header>

              <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto pb-4" data-testid="message-scroller"
                onScroll={(e) => { const el = e.currentTarget; atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; if (el.scrollTop < 40 && hasMore && !loadingOlder) void loadOlder(); }}>
                {hasMore ? (
                  <div className="py-3 text-center">
                    <button type="button" onClick={() => void loadOlder()} className="rounded-full border border-line px-3 py-1 text-xs text-ink-soft hover:border-steel hover:text-steel">
                      {loadingOlder ? "Loading…" : "Load earlier messages"}
                    </button>
                  </div>
                ) : null}
                {loading ? <div className="grid place-items-center py-16 text-ink-faint"><Loader2 className="animate-spin" /></div> : null}
                {!loading && messages.length === 0 ? (
                  <p className="px-6 py-16 text-center text-sm text-ink-faint">No messages yet. {active.kind === "project" ? "Start the conversation with your project team." : "Say hello."}</p>
                ) : null}
                <div ref={timeline}>
                {items.map((it) => it.kind === "day" ? (
                  <div key={it.key} className="sticky top-0 z-10 flex justify-center py-2"><span className="rounded-full bg-steel-wash px-3 py-0.5 text-xs font-medium text-ink-soft shadow-sm">{it.label}</span></div>
                ) : it.kind === "event" ? (
                  <div key={it.key} className="my-2 flex items-center justify-center gap-1.5 text-xs text-ink-faint" data-testid="member-event">
                    {it.join ? <UserPlus size={13} /> : <UserMinus size={13} />} {it.text}
                  </div>
                ) : (
                  <MessageItem key={it.m.id} m={it.m} mine={it.m.sender_id === me.id} grouped={it.grouped} people={peopleMap} meId={me.id}
                    canSeeProfiles={me.isAdmin} receipt={receiptFor(it.m)} highlight={highlight === it.m.id}
                    canDelete={it.m.sender_id === me.id || (me.isAdmin && active.kind === "project")}
                    canEdit={!it.m.pending && !it.m.deleted && (it.m.sender_id === me.id || (me.isAdmin && active.kind === "project"))}
                    editing={editing?.id === it.m.id} onEdit={onEdit}
                    beforeJoin={!!myJoin && it.m.created_at < myJoin && it.m.sender_id !== me.id}
                    onReply={setReplyTo} onJump={(id) => void jumpTo(id)} onDelete={(id) => void onDelete(id)}
                    onOpenImage={(url, name) => setLightbox({ url, name })}
                    onMessagePerson={(uid) => void openDirect(uid)} />
                ))}
                </div>
              </div>

              <Composer key={active.id} conversationId={active.id} canPost={active.can_post} people={people} meId={me.id}
                replyTo={replyTo} onCancelReply={() => setReplyTo(null)} onSend={send} onMentionOpen={refreshPeopleSoon}
                editing={editing} onCancelEdit={() => setEditing(null)} onSaveEdit={saveEdit}
                disabledReason={active.project_archived ? "This project is archived, so its chat is read-only."
                  : active.kind === "direct" && !active.is_participant ? "Admin view: you can read this direct conversation, but only its two participants can write in it."
                  : "This conversation is read-only."} />
            </>
          )}
        </section>

        {/* ------------------------------------------------ info panel */}
        {active && !lost && showInfo ? (
          <aside className="fixed inset-y-0 right-0 z-40 w-[min(20rem,100vw)] overflow-y-auto border-l border-line bg-paper p-3 shadow-xl xl:static xl:z-auto xl:w-72 xl:shadow-none" aria-label="Conversation info" data-testid="info-panel">
            <div className="mb-2 flex justify-end xl:hidden"><button type="button" onClick={() => setShowInfo(false)} className="rounded p-1 text-ink-soft" aria-label="Close info"><X size={18} /></button></div>
            {active.kind === "project" ? (
              <div className="rounded-lg border border-line bg-panel p-3 text-sm">
                <div className="mb-2 flex items-center gap-2 font-semibold"><Info size={16} className="text-steel" /> Project Info</div>
                <dl className="grid grid-cols-[5rem_1fr] gap-y-1.5">
                  <dt className="text-ink-soft">Project</dt><dd className="font-medium">{active.project_code}</dd>
                  <dt className="text-ink-soft">Name</dt><dd>{active.project_name}</dd>
                  <dt className="text-ink-soft">Members</dt><dd>{projectMemberCount}</dd>
                  <dt className="text-ink-soft">Access</dt><dd className="text-xs text-ink-soft">Project members, PMs, the department head and Admins</dd>
                </dl>
                <Link href={`/projects/${active.project_id}`} className="mt-3 inline-block text-sm text-steel underline-offset-2 hover:underline">Open project</Link>
              </div>
            ) : null}
            <div className="mt-3 rounded-lg border border-line bg-panel p-3 text-sm">
              <div className="mb-2 flex items-center gap-2 font-semibold"><Users size={16} className="text-steel" /> {active.kind === "project" ? `People with access (${people.length})` : "People"}</div>
              <ul className="space-y-2" data-testid="member-list">
                {(showAllMembers ? people : people.slice(0, 7)).map((p) => (
                  <li key={p.user_id} className="flex items-center gap-2.5">
                    <Avatar id={p.user_id} name={p.full_name} size={32} online={online.has(p.user_id)} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{p.full_name}{p.user_id === me.id ? " (You)" : ""}</div>
                      <div className="truncate text-xs text-ink-soft">{active.kind === "project" ? roleText(p) : p.role === "admin" ? "Admin" : p.role === "pm" ? "Project Manager" : p.role === "dept_head" ? "Department Head" : "Engineer"}
                        {p.joined_at && active.kind === "project" ? ` · since ${new Date(p.joined_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}</div>
                    </div>
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", online.has(p.user_id) ? "bg-signal-green" : "bg-line")} aria-label={online.has(p.user_id) ? "Online" : "Offline"} />
                  </li>
                ))}
              </ul>
              {people.length > 7 ? (
                <button type="button" onClick={() => setShowAllMembers((v) => !v)} className="mt-2 flex items-center gap-1 text-xs text-steel">
                  {showAllMembers ? <>Show fewer <ChevronUp size={14} /></> : <>+{people.length - 7} more <ChevronDown size={14} /></>}
                </button>
              ) : null}
            </div>
          </aside>
        ) : null}
      </div>

      {lightbox ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4" role="dialog" aria-label={lightbox.name} onClick={() => setLightbox(null)}>
          <img src={lightbox.url} alt={lightbox.name} className="max-h-[85vh] max-w-full rounded-lg" />
          <button type="button" className="absolute right-4 top-4 rounded-full bg-white/90 p-2" aria-label="Close preview"><X size={18} /></button>
        </div>
      ) : null}
    </div>
  );
}
