"use client"

import { DocumentResponsePermission } from "@/api/docs"
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useReducer, useRef, useState } from "react"
import { fetchWsTicket } from "@/api/user"
import type { EditorView } from "@codemirror/view"
import { BlockEditor } from "./BlockEditor"
import { FormattingToolbar } from "./FormattingToolbar"
import { useYDoc } from "./yjs/useYDoc"
import type { User } from "@/hooks/useAuth"
import { colorForUser } from "@/lib/user-color"
import type { PresentUser } from "./PresenceStack"
import type { ConnectionStatus } from "./yjs/provider"
import LatexRenderer from "@/components/LatexRenderer"
import { extractBlocksFromClipboardEvent, writeBlocksToClipboard } from "./blockClipboard"
import { downloadHtml, downloadMarkdown, downloadPdf, downloadPlainText, type ExportBlock } from "./export"

const WS_URL = process.env.NEXT_PUBLIC_WS_URL

export type FocusRequest = { index: number; atEnd: boolean; pos?: number }
export type ExportFormat = "pdf" | "md" | "txt" | "html"
export type TextEditorHandle = { exportAs: (format: ExportFormat) => Promise<void> }

type Props = {
    doc: DocumentResponsePermission
    user: User
    onStatusChange?: (status: ConnectionStatus) => void
    onPresenceChange?: (users: PresentUser[]) => void
}

export const TextEditor = forwardRef<TextEditorHandle, Props>(function TextEditor({
    doc,
    user,
    onStatusChange,
    onPresenceChange,
}, ref) {
    // Called on every (re)connect, because a ticket only lives a minute.
    const wsUrl = useCallback(async () => {
        const ticket = await fetchWsTicket()
        return `${WS_URL}/ws/docs/${doc.id}?token=${encodeURIComponent(ticket)}`
    }, [doc.id])

    const localUser = useMemo(
        () => ({ name: user.username, ...colorForUser(user.id) }),
        [user.id, user.username]
    )

    const {
        awareness,
        undoManager,
        status,
        blocks,
        insertBlock,
        deleteBlock,
        deleteBlockRange,
        insertBlocks,
        mergeBlockIntoPrevious,
    } = useYDoc(wsUrl, localUser)

    useEffect(() => {
        onStatusChange?.(status)
    }, [status, onStatusChange])

    useEffect(() => {
        if (!awareness) return
        const sync = () => {
            const users: PresentUser[] = []
            awareness.getStates().forEach((state, clientId) => {
                const remoteUser = (state as { user?: { name: string; color: string; kind?: string } }).user
                if (remoteUser) users.push({ clientId, name: remoteUser.name, color: remoteUser.color, kind: remoteUser.kind })
            })
            onPresenceChange?.(users)
        }
        sync()
        awareness.on("change", sync)
        return () => {
            awareness.off("change", sync)
            onPresenceChange?.([])
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [awareness])

    const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null)
    const requestFocus = (index: number, atEnd = false, pos?: number) => setFocusRequest({ index, atEnd, pos })
    const clearFocusRequest = () => setFocusRequest(null)

    const containerRef = useRef<HTMLDivElement | null>(null)


    const [selection, setSelection] = useState<{ anchor: number; focus: number } | null>(null)
    const clearSelection = () => setSelection(null)
    const selectionRange = selection
        ? { start: Math.min(selection.anchor, selection.focus), end: Math.max(selection.anchor, selection.focus) }
        : null


    const blocksRef = useRef(blocks)
    blocksRef.current = blocks
    const selectionRangeRef = useRef(selectionRange)
    selectionRangeRef.current = selectionRange
    const readOnlyRef = useRef(doc.permission === "read")
    readOnlyRef.current = doc.permission === "read"
    const actionsRef = useRef({ deleteBlockRange, insertBlocks })
    actionsRef.current = { deleteBlockRange, insertBlocks }


    const DRAG_THRESHOLD_PX = 4
    const dragRef = useRef<{ anchor: number; startX: number; startY: number; moved: boolean } | null>(null)

    const suppressNextClickRef = useRef(false)


    const consumeClickSuppression = () => {
        if (!suppressNextClickRef.current) return false
        suppressNextClickRef.current = false
        return true
    }

    const handleBlockMouseDown = (index: number, e: React.MouseEvent) => {

        e.preventDefault()
        dragRef.current = { anchor: index, startX: e.clientX, startY: e.clientY, moved: false }
    }



    const marqueeRef = useRef<{ startX: number; startContentY: number; lastX: number; lastClientY: number; moved: boolean } | null>(null)
    const [marqueeRect, setMarqueeRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null)

    const contentY = (clientY: number) => clientY + (containerRef.current?.scrollTop ?? 0)

    const handleContainerMouseDown = (e: React.MouseEvent) => {
        if (!(e.target instanceof Element) || e.target.closest("[data-block-index]")) return
        e.preventDefault()
        marqueeRef.current = { startX: e.clientX, startContentY: contentY(e.clientY), lastX: e.clientX, lastClientY: e.clientY, moved: false }
    }

    useEffect(() => {
        const recomputeMarquee = () => {
            const marquee = marqueeRef.current
            if (!marquee || !marquee.moved) return
            const scrollTop = containerRef.current?.scrollTop ?? 0
            const lastContentY = marquee.lastClientY + scrollTop

            const left = Math.min(marquee.startX, marquee.lastX)
            const width = Math.abs(marquee.lastX - marquee.startX)
            const topContent = Math.min(marquee.startContentY, lastContentY)
            const bottomContent = Math.max(marquee.startContentY, lastContentY)
            const top = topContent - scrollTop
            const height = bottomContent - topContent
            setMarqueeRect({ left, top, width, height })


            let minIdx: number | null = null
            let maxIdx: number | null = null
            for (const el of document.querySelectorAll<HTMLElement>("[data-block-index]")) {
                const rect = el.getBoundingClientRect()
                if (top < rect.bottom && top + height > rect.top) {
                    const idx = Number(el.dataset.blockIndex)
                    if (minIdx === null || idx < minIdx) minIdx = idx
                    if (maxIdx === null || idx > maxIdx) maxIdx = idx
                }
            }
            setSelection(minIdx !== null && maxIdx !== null ? { anchor: minIdx, focus: maxIdx } : null)
        }

        const handleMouseMove = (e: MouseEvent) => {
            const drag = dragRef.current
            if (drag) {
                const el = document.elementFromPoint(e.clientX, e.clientY)
                const blockEl = el instanceof Element ? el.closest<HTMLElement>("[data-block-index]") : null
                if (!blockEl) return
                const idx = Number(blockEl.dataset.blockIndex)

                if (!drag.moved) {
                    const dist = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY)
                    if (dist < DRAG_THRESHOLD_PX) return
                    drag.moved = true

                    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
                    window.getSelection()?.removeAllRanges()
                }
                setSelection({ anchor: drag.anchor, focus: idx })
                return
            }

            const marquee = marqueeRef.current
            if (!marquee) return
            if (!marquee.moved) {
                const dist = Math.hypot(e.clientX - marquee.startX, contentY(e.clientY) - marquee.startContentY)
                if (dist < DRAG_THRESHOLD_PX) return
                marquee.moved = true
                if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
                window.getSelection()?.removeAllRanges()
            }
            marquee.lastX = e.clientX
            marquee.lastClientY = e.clientY
            recomputeMarquee()
        }
        const handleScroll = () => recomputeMarquee()
        const handleMouseUp = () => {
            if (dragRef.current?.moved) suppressNextClickRef.current = true
            dragRef.current = null
            if (marqueeRef.current?.moved) suppressNextClickRef.current = true
            marqueeRef.current = null
            setMarqueeRect(null)
        }
        window.addEventListener("mousemove", handleMouseMove)
        window.addEventListener("mouseup", handleMouseUp)

        window.addEventListener("scroll", handleScroll, true)
        return () => {
            window.removeEventListener("mousemove", handleMouseMove)
            window.removeEventListener("mouseup", handleMouseUp)
            window.removeEventListener("scroll", handleScroll, true)
        }
    }, [])


    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const range = selectionRangeRef.current
            if (!range || readOnlyRef.current) return

            if (e.key === "Delete" || e.key === "Backspace") {
                e.preventDefault()
                actionsRef.current.deleteBlockRange(range.start, range.end)
                clearSelection()
                return
            }

            const isMod = e.metaKey || e.ctrlKey
            if (isMod && (e.key === "c" || e.key === "x")) {
                e.preventDefault()
                const contents = blocksRef.current.slice(range.start, range.end + 1).map((b) => b.text.toString())
                writeBlocksToClipboard(contents)
                if (e.key === "x") {
                    actionsRef.current.deleteBlockRange(range.start, range.end)
                    clearSelection()
                }
            }
        }

        const handlePaste = (e: ClipboardEvent) => {
            const range = selectionRangeRef.current
            if (!range || readOnlyRef.current) return
            const contents = extractBlocksFromClipboardEvent(e)
            if (!contents) return

            e.preventDefault()
            actionsRef.current.deleteBlockRange(range.start, range.end)
            actionsRef.current.insertBlocks(range.start, contents)
            setSelection({ anchor: range.start, focus: range.start + contents.length - 1 })
        }

        window.addEventListener("keydown", handleKeyDown)
        document.addEventListener("paste", handlePaste)
        return () => {
            window.removeEventListener("keydown", handleKeyDown)
            document.removeEventListener("paste", handlePaste)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])


    const [activeView, setActiveView] = useState<EditorView | null>(null)


    const handleFocusView = (view: EditorView) => {
        setActiveView(view)
        clearSelection()
    }


    const focusNearestBlock = (clientX: number, clientY: number) => {
        const blockEls = Array.from(
            containerRef.current?.querySelectorAll<HTMLElement>("[data-block-index]") ?? []
        )
        if (blockEls.length === 0) return

        let target = blockEls[blockEls.length - 1]
        for (const el of blockEls) {
            if (clientY <= el.getBoundingClientRect().bottom) {
                target = el
                break
            }
        }

        const rect = target.getBoundingClientRect()
        const index = Number(target.dataset.blockIndex)
        if (clientX < rect.left) {
            requestFocus(index, false)
        } else {
            requestFocus(index, true)
        }
    }


    const handleContainerClick = (e: React.MouseEvent) => {
        if (consumeClickSuppression()) return
        if (!(e.target instanceof Element) || !e.target.closest("[data-block-index]")) {
            clearSelection()
            focusNearestBlock(e.clientX, e.clientY)
        }
    }


    const [, bumpToolbar] = useReducer((n: number) => n + 1, 0)

    const emptyDoc = blocks.length === 1 && blocks[0].text.length === 0


    const [exportSnapshot, setExportSnapshot] = useState<{ title: string; blocks: ExportBlock[]; format: ExportFormat } | null>(null)
    const htmlExportRef = useRef<HTMLDivElement | null>(null)
    // Resolves the promise exportAs returned once a PDF or HTML export has finished, so the Export button can show progress.
    const exportDoneRef = useRef<(() => void) | null>(null)

    useImperativeHandle(ref, () => ({
        exportAs: (format) => {
            const snapshotBlocks = blocks.map((b) => ({ id: b.id, content: b.text.toString() }))
            if (format === "md") {
                downloadMarkdown(doc.title, snapshotBlocks)
                return Promise.resolve()
            }
            if (format === "txt") {
                downloadPlainText(doc.title, snapshotBlocks)
                return Promise.resolve()
            }
            exportDoneRef.current?.()
            return new Promise<void>((resolve) => {
                exportDoneRef.current = resolve
                setExportSnapshot({ title: doc.title, blocks: snapshotBlocks, format })
            })
        },
    }))

    useEffect(() => {
        if (!exportSnapshot) return
        let cancelled = false
        const t = setTimeout(async () => {
            const bodyHtml = htmlExportRef.current?.innerHTML
            if (bodyHtml) {
                if (exportSnapshot.format === "pdf") {
                    await downloadPdf(exportSnapshot.title, bodyHtml)
                } else if (exportSnapshot.format === "html") {
                    downloadHtml(exportSnapshot.title, bodyHtml)
                }
            }
            if (!cancelled) setExportSnapshot(null)
            exportDoneRef.current?.()
            exportDoneRef.current = null
        }, 50)
        return () => {
            cancelled = true
            clearTimeout(t)
        }
    }, [exportSnapshot])

    if (!awareness || !undoManager) {
        return (
            <div className="flex-1 flex items-center justify-center gap-2 bg-desk text-sm text-muted-foreground h-[calc(100vh-180px)]">
                {status === "disconnected" ? "Reconnecting…" : "Loading…"}
            </div>
        )
    }

    return (
        <>
            <div className="flex-1 flex flex-col bg-desk h-[calc(100vh-180px)] print:hidden">
                <FormattingToolbar activeView={activeView} disabled={doc.permission === "read"} />

                <div className="editor-desk flex-1 overflow-y-auto px-3 py-8 sm:px-8 sm:py-10"
                    ref={containerRef}
                    onClick={handleContainerClick}
                    onMouseDown={handleContainerMouseDown}
                >
                  <div className="editor-sheet editor-doc mx-auto flex w-full max-w-4xl flex-col">
                    {status === "disconnected" && (
                        <div className="mb-swap px-10 pb-2 text-xs text-destructive">
                            Connection lost. Reconnecting…
                        </div>
                    )}
                    {blocks.map((block, i) =>
                        <BlockEditor
                            key={block.id}
                            id={block.id}
                            type={block.type}
                            text={block.text}
                            position={i}
                            awareness={awareness}
                            undoManager={undoManager}
                            permission={doc.permission}
                            insertBlock={insertBlock}
                            deleteBlock={deleteBlock}
                            mergeBlockIntoPrevious={mergeBlockIntoPrevious}
                            focusRequest={focusRequest}
                            clearFocusRequest={clearFocusRequest}
                            requestFocus={requestFocus}
                            containerRef={containerRef}
                            emptyDoc={emptyDoc}
                            onFocusView={handleFocusView}
                            onActiveViewUpdate={bumpToolbar}
                            isSelected={
                                selectionRange !== null && i >= selectionRange.start && i <= selectionRange.end
                            }
                            onBlockMouseDown={handleBlockMouseDown}
                            consumeClickSuppression={consumeClickSuppression}
                        />
                    )}
                    <div className="h-[12.5rem] shrink-0" />
                  </div>
                </div>
            </div>

            {marqueeRect && (
                <div
                    className="fixed z-40 rounded-sm border border-ring/50 bg-[var(--wash)] pointer-events-none"
                    style={{
                        left: marqueeRect.left,
                        top: marqueeRect.top,
                        width: marqueeRect.width,
                        height: marqueeRect.height,
                    }}
                />
            )}

            {exportSnapshot && (exportSnapshot.format === "pdf" || exportSnapshot.format === "html") && (

                <div className="hidden">
                    <div ref={htmlExportRef}>
                        <div className="p-16">
                            {exportSnapshot.blocks.map((b) => (
                                <div key={b.id} className="w-full flex justify-center">
                                    <div className="w-full max-w-4xl">
                                        <div className="rounded-md px-10 py-2 text-base font-serif leading-relaxed whitespace-pre-wrap break-words">
                                            <LatexRenderer content={b.content} />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </>
    )
})
