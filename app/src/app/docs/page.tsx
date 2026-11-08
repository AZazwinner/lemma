"use client"

import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/useAuth"
import { useDocuments, useSharedDocuments } from "@/hooks/useDocs"
import { useTrash } from "@/hooks/useTrash"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
import { NewDocumentCard } from "./NewDocumentCard"
import { DocRows, type DocListItem } from "./DocRows"
import { TrashRows } from "./TrashRows"
import { createDoc, deleteDoc, duplicateDoc, permanentlyDeleteDoc, renameDoc, restoreDoc, type TrashedDocument } from "@/api/docs"
import { clearAuthToken } from "@/lib/auth-token"
import { revokeSessionOnServer } from "@/api/user"
import { cn } from "@/lib/utils"
import { UserAvatar } from "@/components/UserAvatar"
import { ThemeToggle } from "@/components/ThemeToggle"
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { FilePlus2, LogOut, Search } from "lucide-react"
import { Logo } from "@/components/Logo"
import { LayoutGroup, motion } from "framer-motion"
import { Segmented } from "@/components/ui/segmented"
import { EmptySet } from "@/components/ui/spinner"

type Tab = "owned" | "shared" | "all" | "trash"
type SortKey = "recent" | "alpha"

const PAGE_SIZE = 20

const TRASH_RETENTION_DAYS = 30

type DateGroup = { label: string; docs: DocListItem[] }

const DATE_BUCKETS = ["Today", "Yesterday", "This week", "This month", "Older"] as const

function bucketFor(iso: string): (typeof DATE_BUCKETS)[number] {
  const date = new Date(iso)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfYesterday = new Date(startOfToday)
  startOfYesterday.setDate(startOfYesterday.getDate() - 1)
  const startOfWeek = new Date(startOfToday)
  startOfWeek.setDate(startOfWeek.getDate() - 7)
  const startOfMonth = new Date(startOfToday)
  startOfMonth.setMonth(startOfMonth.getMonth() - 1)

  if (date >= startOfToday) return "Today"
  if (date >= startOfYesterday) return "Yesterday"
  if (date >= startOfWeek) return "This week"
  if (date >= startOfMonth) return "This month"
  return "Older"
}


function docMatchesQuery(doc: DocListItem, query: string): boolean {
  const q = query.toLowerCase()
  if ((doc.title || "Untitled").toLowerCase().includes(q)) return true
  return (doc.blocks ?? []).some((b) => b.content.toLowerCase().includes(q))
}


function groupByDate(docs: DocListItem[]): DateGroup[] {
  const buckets = new Map<string, DocListItem[]>()
  for (const doc of docs) {
    const label = bucketFor(doc.updated_at)
    if (!buckets.has(label)) buckets.set(label, [])
    buckets.get(label)!.push(doc)
  }
  return DATE_BUCKETS.filter((label) => buckets.has(label)).map((label) => ({
    label,
    docs: buckets.get(label)!,
  }))
}

export default function DocsPage() {
  const router = useRouter()

  const { user, loading: authLoading } = useAuth()
  const { docs, loading: docsLoading, removeDoc, renameDocLocally, refetch } = useDocuments()
  const { docs: sharedDocs, loading: sharedDocsLoading, renameDocLocally: renameSharedDocLocally } = useSharedDocuments()
  const { docs: trashDocs, loading: trashLoading, removeDocLocally: removeTrashDocLocally, refetch: refetchTrash } = useTrash()

  const [query, setQuery] = useState("")
  const [tab, setTab] = useState<Tab>("owned")
  const [sort, setSort] = useState<SortKey>("recent")
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [docPendingDelete, setDocPendingDelete] = useState<DocListItem | null>(null)
  const [trashDocPendingDelete, setTrashDocPendingDelete] = useState<TrashedDocument | null>(null)
  const [searchFocused, setSearchFocused] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  // The list slides in from the side of the tab that was chosen.
  const [tabDirection, setTabDirection] = useState(1)


  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/signin?redirect=/docs")
    }
  }, [user, authLoading, router])


  // Back to the first page whenever the filters change. Done while rendering (not in an effect) so the
  // stale page size is never painted.
  const [pagedFor, setPagedFor] = useState({ tab, query, sort })
  if (pagedFor.tab !== tab || pagedFor.query !== query || pagedFor.sort !== sort) {
    setPagedFor({ tab, query, sort })
    setVisibleCount(PAGE_SIZE)
  }

  const visibleDocs: DocListItem[] = useMemo(() => {
    const owned: DocListItem[] = docs.map((d) => ({ ...d, _shared: false }))
    const shared: DocListItem[] = sharedDocs.map((d) => ({ ...d, _shared: true }))
    const source = tab === "owned" ? owned : tab === "shared" ? shared : tab === "all" ? [...owned, ...shared] : []

    const filtered = query
      ? source.filter((d) => docMatchesQuery(d, query))
      : source

    return [...filtered].sort((a, b) =>
      sort === "alpha"
        ? (a.title || "Untitled").localeCompare(b.title || "Untitled")
        : new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    )
  }, [docs, sharedDocs, tab, query, sort])


  const visibleTrash: TrashedDocument[] = useMemo(() => {
    if (!query) return trashDocs
    return trashDocs.filter((d) => (d.title || "Untitled").toLowerCase().includes(query.toLowerCase()))
  }, [trashDocs, query])

  const pagedDocs = visibleDocs.slice(0, visibleCount)
  const remaining = visibleDocs.length - pagedDocs.length
  const groups: DateGroup[] = sort === "recent" ? groupByDate(pagedDocs) : [{ label: "", docs: pagedDocs }]

  async function handleNewDocument() {
    try {
      const res = await createDoc()
      router.push(`/docs/d/${res.doc_id}`)
    } catch (err) {
      console.error("Failed to create doc:", err)
    }
  }

  function handleDeleteDoc(doc: DocListItem) {
    setDocPendingDelete(doc)
  }

  async function confirmDeleteDoc() {
    const doc = docPendingDelete
    if (!doc) return
    setDocPendingDelete(null)

    try {
      await deleteDoc(doc.id)
      removeDoc(doc.id)

      refetchTrash()
    } catch (err) {
      console.error("Failed to delete doc:", err)
    }
  }

  async function handleRestoreDoc(doc: TrashedDocument) {
    try {
      await restoreDoc(doc.id)
      removeTrashDocLocally(doc.id)
      refetch()
    } catch (err) {
      console.error("Failed to restore doc:", err)
    }
  }

  function handleDeleteForeverDoc(doc: TrashedDocument) {
    setTrashDocPendingDelete(doc)
  }

  async function confirmDeleteForeverDoc() {
    const doc = trashDocPendingDelete
    if (!doc) return
    setTrashDocPendingDelete(null)

    try {
      await permanentlyDeleteDoc(doc.id)
      removeTrashDocLocally(doc.id)
    } catch (err) {
      console.error("Failed to permanently delete doc:", err)
    }
  }

  async function handleRenameDoc(doc: DocListItem, newTitle: string) {
    try {
      await renameDoc(doc.id, newTitle)
      if (doc._shared) {
        renameSharedDocLocally(doc.id, newTitle)
      } else {
        renameDocLocally(doc.id, newTitle)
      }
    } catch (err) {
      console.error("Failed to rename doc:", err)
    }
  }

  async function handleDuplicateDoc(doc: DocListItem) {
    try {
      await duplicateDoc(doc.id)
      await refetch()
    } catch (err) {
      console.error("Failed to duplicate doc:", err)
    }
  }

  function handleSignOut() {
    revokeSessionOnServer()
    clearAuthToken()
    router.push("/")
  }


  if (authLoading || docsLoading || sharedDocsLoading) {
    return (
      <div className="paper-surface flex h-screen items-center justify-center gap-2 bg-desk text-sm text-ink-faint">
        Loading your workspace&hellip;
      </div>
    )
  }


  if (!user) return null

  const TABS: { key: Tab; label: string; count: number }[] = [
    { key: "owned", label: "Owned", count: docs.length },
    { key: "shared", label: "Shared with you", count: sharedDocs.length },
    { key: "all", label: "All", count: docs.length + sharedDocs.length },
    { key: "trash", label: "Trash", count: trashDocs.length },
  ]

  return (
    <div className="paper-surface flex h-screen flex-col bg-desk text-ink">
      <DeleteConfirmDialog
        open={docPendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setDocPendingDelete(null)
        }}
        title={`Delete "${docPendingDelete?.title || "Untitled"}"?`}
        description={`Moves to Trash - you can restore it within ${TRASH_RETENTION_DAYS} days.`}
        onConfirm={confirmDeleteDoc}
      />

      <DeleteConfirmDialog
        open={trashDocPendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setTrashDocPendingDelete(null)
        }}
        title={`Permanently delete "${trashDocPendingDelete?.title || "Untitled"}"?`}
        description="This can't be undone."
        onConfirm={confirmDeleteForeverDoc}
      />


      <header className="flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-hairline-soft bg-sheet px-5 py-2.5">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Logo className="h-4 w-4" />
          lemma
        </div>

        {/* On focus the magnifier slides to the right end and becomes the search button. It runs the same live filter. */}
        <form
          role="search"
          data-active={searchFocused || query !== ""}
          onSubmit={(e) => {
            e.preventDefault()
            setQuery(searchRef.current?.value ?? query)
            searchRef.current?.focus()
          }}
          onFocus={() => setSearchFocused(true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setSearchFocused(false)
          }}
          className="group/search relative order-3 w-full sm:order-none sm:w-auto sm:max-w-sm sm:flex-1"
        >
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && query) {
                e.preventDefault()
                setQuery("")
              }
            }}
            placeholder="Search documents"
            aria-label="Search documents"
            className="h-[2.125rem] w-full rounded-lg border border-hairline bg-desk pr-10 pl-8 text-sm text-ink outline-none transition-[border-color,box-shadow,background-color,padding] duration-300 placeholder:text-ink-faint group-data-[active=true]/search:border-ring group-data-[active=true]/search:bg-sheet group-data-[active=true]/search:pl-3 group-data-[active=true]/search:ring-4 group-data-[active=true]/search:ring-ring/12 [&::-webkit-search-cancel-button]:hidden"
          />
          <button
            type="submit"
            aria-label="Search"
            tabIndex={searchFocused || query !== "" ? 0 : -1}
            className="absolute top-1/2 left-1 flex h-[1.625rem] w-[1.625rem] -translate-y-1/2 items-center justify-center rounded-md text-ink-faint transition-[left,background-color,color,scale] duration-[400ms] ease-[cubic-bezier(0.2,0.7,0.2,1)] group-data-[active=true]/search:left-[calc(100%-30px)] group-data-[active=true]/search:bg-primary group-data-[active=true]/search:text-primary-foreground hover:scale-105 active:scale-95"
          >
            <Search className="h-3.5 w-3.5 transition-transform duration-[400ms] group-data-[active=true]/search:rotate-90" />
          </button>
        </form>

        <div className="flex items-center gap-2">
          <Button onClick={handleNewDocument} data-anim="lift" className="h-[2.125rem] px-3.5">
            <FilePlus2 className="h-4 w-4" />
            New document
          </Button>

          <ThemeToggle />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="Account menu" className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                <UserAvatar userId={user.id} name={user.username} className="h-8 w-8 text-[0.9375rem]" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>
                <div className="font-medium text-foreground">{user.username}</div>
                <div className="truncate text-xs font-normal">{user.email}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={handleSignOut}>
                <LogOut className="h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>


      <div className="flex-1 overflow-y-auto px-4 py-10 sm:px-8">
        <div className="mx-auto flex max-w-3xl flex-col gap-9">
          {tab !== "trash" && (
            <section>
              <h2 className="mb-3 text-sm font-semibold tracking-[-0.005em] text-ink">Start a new document</h2>
              <NewDocumentCard onCreate={handleNewDocument} />
            </section>
          )}

          <section className="rounded-xl border border-hairline bg-sheet px-3 pt-4 pb-3 sm:px-5">
            <div className="mb-2 flex flex-wrap items-end justify-between gap-3 border-b border-hairline-soft">
              <div className="flex flex-wrap gap-x-5 gap-y-1">
                {TABS.map((t, i) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => {
                      setTabDirection(i >= TABS.findIndex((x) => x.key === tab) ? 1 : -1)
                      setTab(t.key)
                    }}
                    className={cn(
                      "group/tab relative pb-2.5 text-[0.8125rem] font-medium transition-colors duration-200",
                      tab === t.key ? "text-ink" : "text-ink-faint hover:text-ink"
                    )}
                  >
                    {t.label}
                    <span
                      className={cn(
                        "ml-1.5 inline-flex h-[1.125rem] min-w-5 items-center justify-center rounded-full px-1.5 text-[0.7188rem] font-medium tabular-nums transition-[background-color,color,transform] duration-200 group-hover/tab:-translate-y-px",
                        tab === t.key ? "bg-primary text-primary-foreground" : "bg-muted text-ink-faint"
                      )}
                    >
                      {t.count}
                    </span>
                    {tab === t.key ? (
                      <motion.span
                        layoutId="doc-tab-ink"
                        transition={{ type: "spring", stiffness: 420, damping: 36 }}
                        className="absolute inset-x-0 -bottom-px h-[0.125rem] rounded-full bg-primary"
                      />
                    ) : (
                      <span className="absolute inset-x-0 -bottom-px h-[0.125rem] origin-center scale-x-0 rounded-full bg-hairline transition-transform duration-200 group-hover/tab:scale-x-100" />
                    )}
                  </button>
                ))}
              </div>

              {tab !== "trash" && (
                <Segmented
                  className="mb-2"
                  label="Sort documents"
                  value={sort}
                  onChange={setSort}
                  options={[
                    { value: "recent", label: "Last edited" },
                    { value: "alpha", label: "A–Z" },
                  ]}
                />
              )}
            </div>

            <motion.div
              key={tab}
              initial={{ opacity: 0, x: 18 * tabDirection }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.32, ease: [0.2, 0.7, 0.2, 1] }}
            >
              {tab === "trash" ? (
                visibleTrash.length === 0 ? (
                  <ListEmpty>{query ? `No trashed documents match "${query}"` : "Trash is empty"}</ListEmpty>
                ) : (
                  <TrashRows docs={visibleTrash} onRestore={handleRestoreDoc} onDeleteForever={handleDeleteForeverDoc} />
                )
              ) : visibleDocs.length === 0 ? (
                <EmptyState query={query} tab={tab} onNewDocument={handleNewDocument} />
              ) : (
                <LayoutGroup id={tab}>
                  {groups.map((group, i) => (
                    <div key={group.label || "flat"}>
                      {group.label && (
                        <div className={cn("mb-1 px-2 text-xs font-medium text-ink-faint mb-swap", i > 0 ? "mt-4" : "mt-2")}>
                          {group.label}
                        </div>
                      )}
                      <DocRows
                        docs={group.docs}
                        currentUser={user}
                        onDelete={handleDeleteDoc}
                        onRename={handleRenameDoc}
                        onDuplicate={handleDuplicateDoc}
                      />
                    </div>
                  ))}

                  {remaining > 0 && (
                    <div className="flex justify-center pt-4 pb-1">
                      <Button size="sm" variant="outline" onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}>
                        Load {Math.min(PAGE_SIZE, remaining)} more
                      </Button>
                    </div>
                  )}
                </LayoutGroup>
              )}
            </motion.div>
          </section>
        </div>
      </div>
    </div>
  )
}

const EMPTY_LABEL: Record<Tab, string> = {
  owned: "No documents yet",
  shared: "Nothing has been shared with you yet",
  all: "No documents yet",
  trash: "Trash is empty",
}

function ListEmpty({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-swap flex flex-col items-center gap-3 px-4 py-12 text-center">
      <EmptySet />
      <div className="text-sm text-ink-soft">{children}</div>
      {action}
    </div>
  )
}

function EmptyState({
  query,
  tab,
  onNewDocument,
}: {
  query: string
  tab: Tab
  onNewDocument: () => void
}) {
  return (
    <ListEmpty
      action={
        !query && tab !== "shared" ? (
          <Button size="sm" variant="outline" onClick={onNewDocument} data-anim="lift">
            <FilePlus2 className="h-4 w-4" />
            Start your first document
          </Button>
        ) : undefined
      }
    >
      {query ? `No documents match "${query}"` : EMPTY_LABEL[tab]}
    </ListEmpty>
  )
}
