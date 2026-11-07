"use client"

import { useEffect, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { TextEditor, type TextEditorHandle } from "./TextEditor"
import { Button } from "@/components/ui/button"
import { updateTitle } from "@/hooks/autoSaveDoc"
import { SharePopover } from "./SharePopover"
import { ExportMenu } from "./ExportMenu"
import { deleteDoc, DocumentResponsePermission, restoreDocVersion } from "@/api/docs"
import { useAuth } from "@/hooks/useAuth"
import { apiFetch } from "@/lib/api-fetch"
import { ArrowLeft, Eye, Trash2 } from "lucide-react"
import { Tip } from "@/components/ui/tooltip"
import { UnitSpinner } from "@/components/ui/spinner"
import { SaveStatus } from "./SaveStatus"
import { PresenceStack, type PresentUser } from "./PresenceStack"
import { ThemeToggle } from "@/components/ThemeToggle"
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog"
import { VersionHistoryPopover } from "./VersionHistoryPopover"
import type { ConnectionStatus } from "./yjs/provider"
import { SidekickButton } from "@/components/sidekick/SidekickButton"

const API_URL = process.env.NEXT_PUBLIC_API_URL

// "no-token" means the user is signed out; null means the request failed (already logged).
async function fetchDocument(id: string): Promise<DocumentResponsePermission | "no-token" | null> {
  const token = localStorage.getItem("token")
  if (!token) return "no-token"

  try {
    const res = await apiFetch(`${API_URL}/docs/${id}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!res.ok) throw new Error("Failed to load doc")

    return await res.json()
  } catch (err) {
    console.error(err)
    return null
  }
}

export default function DocPage() {
  const router = useRouter()
  const params = useParams();
  const id = params?.id as string;

  const [doc, setDoc] = useState<DocumentResponsePermission | null>(null)
  const [loading, setLoading] = useState(true)

  const { user, loading: authLoading } = useAuth()

  // What the user has typed into the title box; null means "show the saved title". Cleared whenever the
  // document is (re)loaded, so a restored version's title replaces anything typed before it.
  const [titleDraft, setTitleDraft] = useState<string | null>(null)
  const title = titleDraft ?? doc?.title ?? "Untitled Document"

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTitleDraft(e.target.value);
    updateTitle(id, e.target.value);
  };

  const [status, setStatus] = useState<ConnectionStatus>("connecting")
  const [presence, setPresence] = useState<PresentUser[]>([])
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const editorRef = useRef<TextEditorHandle>(null)

  function applyFetched(result: DocumentResponsePermission | "no-token" | null) {
    if (result === "no-token") {
      router.replace("/signin")
    } else if (result) {
      setDoc(result)
      setTitleDraft(null)
    }
  }

  async function loadDoc() {
    applyFetched(await fetchDocument(id))
  }

  // The first load is fetched here so it can be dropped if the page unmounts or the id changes first.
  useEffect(() => {
    let active = true
    fetchDocument(id)
      .then((result) => {
        if (active) applyFetched(result)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, router])


  async function handleRestoreVersion(versionId: number) {
    setRestoring(true)
    await new Promise((resolve) => setTimeout(resolve, 700))
    try {
      await restoreDocVersion(Number(id), versionId)
    } finally {
      await loadDoc()
      setRestoring(false)
    }
  }

  if (loading || authLoading) {
    return (
      <div className="h-screen flex items-center justify-center gap-2 bg-desk text-sm text-muted-foreground">
        <UnitSpinner />
        Loading document...
      </div>
    )
  }

  if (!doc || !user) {
    return (
      <div className="h-screen flex items-center justify-center bg-desk text-sm text-ink-soft">
        Document not found
      </div>
    )
  }

  const isReadOnly = doc.permission === "read"
  const isOwner = doc.owner_id === user.id

  async function confirmDelete() {
    setDeleteDialogOpen(false)

    try {
      await deleteDoc(Number(id))
      router.push("/docs")
    } catch (err) {
      console.error("Failed to delete doc:", err)
    }
  }

  return (
    <div className="h-screen w-full flex flex-col bg-desk">
      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={`Delete "${doc.title || "Untitled"}"?`}
        description="This can't be undone."
        onConfirm={confirmDelete}
      />


      <div className="flex min-h-14 flex-wrap items-center justify-between gap-2 border-b border-hairline-soft bg-sheet px-3 py-2 sm:px-4 print:hidden">


        <div className="flex items-center gap-3 min-w-0">
          <Tip label="Back to documents">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Back to documents"
              data-anim="back"
              className="text-ink-soft"
              onClick={() => router.push("/docs")}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Tip>

          <input
            value={title}
            onChange={handleTitleChange}
            aria-label="Document title"
            className="w-[18rem] max-w-[40vw] min-w-0 border-b border-transparent bg-transparent py-0.5 text-sm font-medium text-ink outline-none transition-colors hover:border-hairline focus:border-ring"
            disabled={isReadOnly}
          />

          <SaveStatus status={status} />
        </div>


        <div className="flex flex-wrap items-center gap-2">
          <PresenceStack users={presence} />

          <SidekickButton docId={Number(id)} readOnly={isReadOnly} />

          <ThemeToggle />

          <ExportMenu onExport={(format) => editorRef.current?.exportAs(format)} />

          {!isReadOnly && <VersionHistoryPopover docId={Number(id)} onRestore={handleRestoreVersion} />}

          <SharePopover doc={doc} user={user}/>

          {isOwner && (
            <Tip label="Delete document">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Delete document"
                data-anim="tilt"
                className="text-ink-faint hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setDeleteDialogOpen(true)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </Tip>
          )}
        </div>
      </div>

      {isReadOnly && (
        <div className="flex items-center gap-2 border-b border-hairline-soft bg-tint px-4 py-1.5 text-xs text-ink-soft print:hidden">
          <Eye className="h-3.5 w-3.5" />
          Viewing only. You don&apos;t have permission to edit this document.
        </div>
      )}


      {restoring ? (
        <div className="flex flex-1 items-center justify-center gap-2 bg-desk text-sm text-muted-foreground">
          <UnitSpinner />
          Restoring version…
        </div>
      ) : (
        <TextEditor
          key={doc.updated_at}
          ref={editorRef}
          doc={doc}
          user={user}
          onStatusChange={setStatus}
          onPresenceChange={setPresence}
        />
      )}

    </div>
  )
}
