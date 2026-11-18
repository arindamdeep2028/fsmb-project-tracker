import type { Database } from "@/types/database";

type Fn = Database["public"]["Functions"];
export type InboxRow = Fn["chat_inbox"]["Returns"][number];
export type PersonRow = Fn["chat_people"]["Returns"][number];
export type MemberEvent = Fn["chat_member_events"]["Returns"][number];
export type Candidate = Fn["chat_dm_candidates"]["Returns"][number];
export type Attachment = { id: string; storage_path: string; file_name: string; mime_type: string; size_bytes: number };
export type MessageRow = Omit<Fn["chat_message_rows"]["Returns"][number], "attachments"> & {
  attachments: Attachment[];
  /** set on messages this browser is still sending */
  pending?: boolean;
};
export type Me = { id: string; name: string; isAdmin: boolean };

