"use client"

import { RotateCcw, Trash2 } from "lucide-react"
import type { TrashedDocument } from "@/api/docs"
import { formatRelativeTime } from "@/lib/utils"


function monogram(title: string): string {
  const clean = (title || "Untitled").trim()
  const words = clean.split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return clean.slice(0, 2).toUpperCase()
}

export function TrashRows({
  docs,
  onRestore,
  onDeleteForever,
}: {
  docs: TrashedDocument[]
  onRestore: (doc: TrashedDocument) => void
  onDeleteForever: (doc: TrashedDocument) => void
}) {
  return (
    <div>
      {docs.map((doc) => {
        const title = doc.title || "Untitled"
        return (
          <div
            key={doc.id}
            className="group/row flex w-full items-center gap-3 rounded-lg px-2 py-2 transition-colors duration-150 hover:bg-tint focus-within:bg-tint"
          >
            <div className="flex h-9 w-11 shrink-0 items-center justify-center rounded-md border border-hairline bg-page font-heading text-sm text-ink-faint italic transition-colors duration-200 group-hover/row:border-ink-faint/40 group-hover/row:text-ink">
              {monogram(title)}
            </div>

            <div className="flex min-h-[34px] min-w-0 flex-1 flex-col justify-center">
              <div className="truncate text-[14px] font-medium text-ink">{title}</div>
              <div className="mt-0.5 truncate text-[12px] text-ink-faint">
                Deleted {formatRelativeTime(doc.deleted_at)}
              </div>
            </div>

            <div className="flex shrink-0 translate-x-1.5 items-center gap-1 opacity-0 transition-[opacity,transform] duration-200 group-hover/row:translate-x-0 group-hover/row:opacity-100 focus-within:translate-x-0 focus-within:opacity-100 [@media(hover:none)]:translate-x-0 [@media(hover:none)]:opacity-100">
              <button
                type="button"
                aria-label={`Restore ${title}`}
                onClick={() => onRestore(doc)}
                data-anim="turn"
                className="rounded-md p-1.5 text-ink-faint transition-colors hover:bg-sheet hover:text-ink"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label={`Delete ${title} forever`}
                onClick={() => onDeleteForever(doc)}
                data-anim="tilt"
                className="rounded-md p-1.5 text-ink-faint transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
