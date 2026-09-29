"use client";
import { useState } from "react";
import { addComment, deleteComment, editComment } from "@/lib/actions/tasks";
import { ago } from "@/lib/time";
import { useAction } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/form";

type Comment = { id: string; body: string; created_at: string; edited_at: string | null; deleted_at: string | null; author_id: string; author: { full_name: string } | null };

/** Comments on a task. A PM comment notifies the assignee (database). Authors edit their own; Admin moderates any. */
export function CommentThread({ taskId, comments, meId, canComment, isAdmin }: { taskId: string; comments: Comment[]; meId: string; canComment: boolean; isAdmin: boolean }) {
  const [body, setBody] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const { pending, run } = useAction();
  return (
    <div className="space-y-4">
      {comments.length === 0 ? <p className="text-sm text-ink-soft">No comments yet.</p> : null}
      <ul className="space-y-3">
        {comments.map((c) => (
          <li key={c.id} className="rounded-md border border-line-soft p-3">
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">{c.author?.full_name ?? "Former member"}</span>
              <span className="text-ink-faint">{ago(c.created_at)}{c.edited_at ? " · edited" : ""}</span>
            </div>
            {c.deleted_at ? <p className="text-sm italic text-ink-faint">Comment deleted</p>
              : editing === c.id ? (
                <div className="space-y-2">
                  <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} />
                  <div className="flex gap-2"><Button size="sm" pending={pending} onClick={() => run(() => editComment(c.id, draft), () => setEditing(null))}>Save</Button><Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button></div>
                </div>
              ) : <p className="whitespace-pre-wrap text-[15px]">{c.body}</p>}
            {!c.deleted_at && editing !== c.id && (c.author_id === meId || isAdmin) ? (
              <div className="mt-2 flex gap-3 text-sm">
                <button className="text-steel hover:underline" onClick={() => { setEditing(c.id); setDraft(c.body); }}>Edit</button>
                <button className="text-signal-red hover:underline" onClick={() => run(() => deleteComment(c.id))}>Delete</button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {canComment ? (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); run(() => addComment(taskId, body), () => setBody("")); }}>
          <label htmlFor="new-comment" className="sr-only">Add a comment</label>
          <Textarea id="new-comment" value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="Add a comment" maxLength={4000} />
          <Button size="sm" type="submit" pending={pending} disabled={!body.trim()}>Post comment</Button>
        </form>
      ) : null}
    </div>
  );
}
