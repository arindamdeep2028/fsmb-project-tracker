"use client";
import { FileText, Trash2 } from "lucide-react";
import { deleteAttachment } from "@/lib/actions/reports";
import { isImage } from "@/lib/storage";
import { useAction } from "@/components/toast";

type A = { id: string; file_name: string; mime_type: string; size_bytes: number; url: string | null };

export function AttachmentGallery({ files, canDelete }: { files: A[]; canDelete: boolean }) {
  const { pending, run } = useAction();
  if (!files.length) return <p className="text-sm text-ink-soft">No files attached.</p>;
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {files.map((f) => (
        <li key={f.id} className="group relative overflow-hidden rounded-md border border-line bg-paper">
          <a href={f.url ?? undefined} target="_blank" rel="noreferrer" className="block">
            {isImage(f.mime_type) && f.url && f.mime_type !== "image/heic" ? (
              // Signed URLs expire in 10 minutes, so next/image caching doesn't help here.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={f.url} alt={f.file_name} className="aspect-[4/3] w-full object-cover" loading="lazy" />
            ) : (
              <div className="grid aspect-[4/3] place-items-center text-ink-faint"><FileText size={32} /></div>
            )}
            <div className="truncate px-2 py-1.5 text-xs">{f.file_name} · {(f.size_bytes / 1024 / 1024).toFixed(1)} MB</div>
          </a>
          {canDelete ? (
            <button aria-label={`Remove ${f.file_name}`} disabled={pending} onClick={() => confirm(`Remove ${f.file_name}?`) && run(() => deleteAttachment(f.id))}
              className="absolute right-1.5 top-1.5 rounded bg-panel/90 p-1 text-signal-red opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100"><Trash2 size={16} /></button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
