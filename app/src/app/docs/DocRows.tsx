"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Copy, ExternalLink, Link2, MoreHorizontal, PencilLine, Share2, Trash2 } from "lucide-react"
import { motion } from "framer-motion"
import { Document } from "@/hooks/useDocs"
import type { User } from "@/hooks/useAuth"
import { ShareContent } from "./d/[id]/SharePopover"
import { colorForUser } from "@/lib/user-color"
import { cn, formatRelativeTime } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"

export type DocListItem = Document & { _shared?: boolean }

const PERMISSION_LABEL: Record<string, string> = {
  read: "Can view",
  write: "Can edit",
}

function monogram(title: string): string {
  const clean = (title || "Untitled").trim()
  const words = clean.split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return clean.slice(0, 2).toUpperCase()
}

export function DocRows({
  docs,
  currentUser,
  onDelete,
  onRename,
  onDuplicate,
}: {
  docs: DocListItem[]
  currentUser: User
  onDelete?: (doc: DocListItem) => void
  onRename?: (doc: DocListItem, title: string) => void
  onDuplicate?: (doc: DocListItem) => void
}) {
  return (
    <div>
      {docs.map((doc) => (
        <motion.div
          key={`${doc._shared ? "s" : "o"}-${doc.id}`}
          layoutId={`row-${doc._shared ? "s" : "o"}-${doc.id}`}
          layout="position"
          transition={{ duration: 0.4, ease: [0.2, 0.7, 0.2, 1] }}
        >
          <DocRow
            doc={doc}
            currentUser={currentUser}
            onDelete={onDelete}
            onRename={onRename}
            onDuplicate={onDuplicate}
          />
        </motion.div>
      ))}
    </div>
  )
}

function DocRow({
  doc,
  currentUser,
  onDelete,
  onRename,
  onDuplicate,
}: {
  doc: DocListItem
  currentUser: User
  onDelete?: (doc: DocListItem) => void
  onRename?: (doc: DocListItem, title: string) => void
  onDuplicate?: (doc: DocListItem) => void
}) {
  const router = useRouter()
  const title = doc.title || "Untitled"

  const [isRenaming, setIsRenaming] = useState(false)
  const [titleDraft, setTitleDraft] = useState(title)
  const [menuOpen, setMenuOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isRenaming) return

    const id = setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 0)
    return () => clearTimeout(id)
  }, [isRenaming])


  const isOwner = !doc._shared
  const canWrite = isOwner || doc.permission === "write"
  const docUrl = `${process.env.NEXT_PUBLIC_APP_URL}/docs/d/${doc.id}`

  function commitRename() {
    setIsRenaming(false)
    const trimmed = titleDraft.trim()
    if (trimmed && trimmed !== title) {
      onRename?.(doc, trimmed)
    } else {
      setTitleDraft(title)
    }
  }

  return (
    <Popover open={shareOpen} onOpenChange={setShareOpen}>
      <div className="group/row flex w-full items-center gap-3 rounded-lg px-2 py-2 transition-colors duration-150 hover:bg-tint focus-within:bg-tint">
        {isRenaming ? (
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="flex h-9 w-11 shrink-0 items-center justify-center rounded-md border border-hairline bg-page font-heading text-sm text-ink-faint italic transition-colors duration-200 group-hover/row:border-ink-faint/40 group-hover/row:text-ink">
              {monogram(title)}
            </div>
            <input
              ref={inputRef}
              aria-label={`Rename ${title}`}
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur()
                if (e.key === "Escape") {
                  setTitleDraft(title)
                  e.currentTarget.blur()
                }
              }}
              onBlur={commitRename}
              className="min-h-[34px] min-w-0 flex-1 rounded-md border border-hairline bg-sheet px-2 text-[14px] font-medium text-ink outline-none transition-shadow focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/12"
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => router.push(`/docs/d/${doc.id}`)}
            className="flex min-w-0 flex-1 items-center gap-3 text-left"
          >
            <div className="flex h-9 w-11 shrink-0 items-center justify-center rounded-md border border-hairline bg-page font-heading text-sm text-ink-faint italic transition-colors duration-200 group-hover/row:border-ink-faint/40 group-hover/row:text-ink">
              {monogram(title)}
            </div>

            <div className="flex min-h-[34px] min-w-0 flex-col justify-center">
              <div className="truncate text-[14px] font-medium text-ink">{title}</div>
              {doc._shared && (
                <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-ink-faint">
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: colorForUser(doc.owner_id).color }}
                  />
                  <span className="truncate">{doc.owner_username || "Unknown"}</span>
                  {doc.permission && (
                    <>
                      <span aria-hidden>&middot;</span>
                      <span className="shrink-0">{PERMISSION_LABEL[doc.permission] ?? doc.permission}</span>
                    </>
                  )}
                </div>
              )}
            </div>
            <span aria-hidden className="mb-leader hidden sm:block" />
          </button>
        )}

        <div className="shrink-0 text-[12.5px] tabular-nums text-ink-faint transition-colors duration-200 group-hover/row:text-ink">
          {formatRelativeTime(doc.updated_at)}
        </div>

        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>

          <PopoverAnchor asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`More actions for ${title}`}
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  "shrink-0 translate-x-1.5 rounded-md p-1.5 text-ink-faint opacity-0 transition-[opacity,transform,background-color,color] duration-200",
                  "hover:bg-sheet hover:text-ink [@media(hover:none)]:translate-x-0 [@media(hover:none)]:opacity-100",
                  "group-hover/row:translate-x-0 group-hover/row:opacity-100 focus-visible:translate-x-0 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                  "data-[state=open]:translate-x-0 data-[state=open]:bg-sheet data-[state=open]:opacity-100"
                )}
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
          </PopoverAnchor>

          <DropdownMenuContent align="end">
            {canWrite && (
              <DropdownMenuItem onSelect={() => setIsRenaming(true)}>
                <PencilLine className="h-4 w-4" />
                Rename
              </DropdownMenuItem>
            )}

            <DropdownMenuItem onSelect={() => onDuplicate?.(doc)}>
              <Copy className="h-4 w-4" />
              Duplicate
            </DropdownMenuItem>

            <DropdownMenuItem onSelect={() => navigator.clipboard.writeText(docUrl)}>
              <Link2 className="h-4 w-4" />
              Copy link
            </DropdownMenuItem>

            <DropdownMenuItem onSelect={() => window.open(docUrl, "_blank", "noopener,noreferrer")}>
              <ExternalLink className="h-4 w-4" />
              Open in new tab
            </DropdownMenuItem>

            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault()
                setMenuOpen(false)

                setTimeout(() => setShareOpen(true), 200)
              }}
            >
              <Share2 className="h-4 w-4" />
              Share
            </DropdownMenuItem>

            {isOwner && onDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => onDelete(doc)}>
                  <Trash2 className="h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <PopoverContent align="end" className="w-80 space-y-2">
        <ShareContent
          doc={{
            id: doc.id,
            owner_id: doc.owner_id,

            owner_username: doc._shared ? doc.owner_username : currentUser.username,
            permission: doc._shared ? ((doc.permission as "read" | "write") ?? "read") : "owner",
          }}
          user={currentUser}
        />
      </PopoverContent>
    </Popover>
  )
}
