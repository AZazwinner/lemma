"use client"

import { useEffect, useLayoutEffect, useState } from "react"
import { createPortal } from "react-dom"
import type { EditorView } from "@codemirror/view"
import { Button } from "@/components/ui/button"
import { blockIdOfView } from "@/lib/sidekick"
import { ACTIONS } from "@/lib/sidekick-actions"
import { SIDEKICK_ACTIONS } from "./action-list"
import { useSidekick } from "./useSidekick"

// A small labelled toolbar next to the selection (or above a block that is selected as a whole), with the four things the
// sidekick does. It appears once the selection has settled, goes when the selection does, and never takes the focus:
// pressing its buttons leaves the caret and the selection where they were.

const WIDTH = 330
const HEIGHT = 34
const GAP = 6

type Place = { key: string; blockId: string; whole: boolean; left: number; top: number }

export function SelectionToolbar({
    activeView,
    blockSelection,
    blockIds,
    containerRef,
    readOnly,
    tick,
}: {
    /** The editor of the block the writer was last in. */
    activeView: EditorView | null
    /** Blocks selected as a whole (by dragging across them). */
    blockSelection: { start: number; end: number } | null
    blockIds: string[]
    containerRef: React.RefObject<HTMLDivElement | null>
    readOnly: boolean
    /** Changes whenever the editor's text or selection does, so the toolbar follows it. */
    tick: number
}) {
    const s = useSidekick()
    const [place, setPlace] = useState<Place | null>(null)
    const [pointerDown, setPointerDown] = useState(false)
    const [scrolled, setScrolled] = useState(0)
    // After a button is used, the toolbar steps aside until the selection changes, so it doesn't sit on top of the answer.
    const [usedFor, setUsedFor] = useState<string | null>(null)

    useEffect(() => {
        const down = (event: MouseEvent) => {
            if (!(event.target instanceof Element) || !event.target.closest("[data-sidekick-toolbar]")) setPointerDown(true)
        }
        const up = () => setPointerDown(false)
        const moved = () => setScrolled((n) => n + 1)
        const container = containerRef.current
        window.addEventListener("mousedown", down, true)
        window.addEventListener("mouseup", up, true)
        window.addEventListener("blur", up)
        window.addEventListener("resize", moved)
        container?.addEventListener("scroll", moved, { passive: true })
        return () => {
            window.removeEventListener("mousedown", down, true)
            window.removeEventListener("mouseup", up, true)
            window.removeEventListener("blur", up)
            window.removeEventListener("resize", moved)
            container?.removeEventListener("scroll", moved)
        }
    }, [containerRef])

    // Where the toolbar goes is read from the page's layout, so it is worked out after each render and only stored if it moved.
    useLayoutEffect(() => {
        const next = pointerDown ? null : placeFor()
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setPlace((previous) => (previous?.key === next?.key && previous?.left === next?.left && previous?.top === next?.top ? previous : next))

        function placeFor(): Place | null {
            if (blockSelection) {
                if (blockSelection.start !== blockSelection.end) return null
                const blockId = blockIds[blockSelection.start]
                const el = containerRef.current?.querySelector<HTMLElement>(`[data-block-index="${blockSelection.start}"]`)
                if (!blockId || !el) return null
                const rect = el.getBoundingClientRect()
                return position(`block:${blockId}`, blockId, true, rect.left + 40, rect.top, rect.bottom)
            }
            if (!activeView || !activeView.hasFocus) return null
            const selection = activeView.state.selection.main
            const blockId = blockIdOfView(activeView)
            if (selection.empty || !blockId) return null
            const start = activeView.coordsAtPos(selection.from)
            if (!start) return null
            return position(`text:${blockId}:${selection.from}-${selection.to}`, blockId, false, start.left, start.top, start.bottom)
        }

        function position(key: string, blockId: string, whole: boolean, left: number, top: number, bottom: number): Place | null {
            const area = containerRef.current?.getBoundingClientRect()
            if (area && (bottom < area.top || top > area.bottom)) return null // scrolled out of view
            const above = top - HEIGHT - GAP
            const y = above >= (area?.top ?? 0) + 4 ? above : bottom + GAP
            const x = Math.max(8, Math.min(left, window.innerWidth - WIDTH - 8))
            return { key, blockId, whole, left: Math.round(x), top: Math.round(y) }
        }
    }, [activeView, blockSelection, blockIds, containerRef, tick, scrolled, pointerDown, usedFor])

    if (s.availability !== "ready" || !place || usedFor === place.key) return null

    return createPortal(
        <div
            data-sidekick-toolbar
            role="toolbar"
            aria-label="Sidekick"
            data-testid="sidekick-selection-toolbar"
            style={{ left: place.left, top: place.top }}
            onMouseDown={(e) => e.preventDefault()}
            className="fixed z-40 flex items-center gap-0.5 rounded-lg border border-hairline bg-popover p-0.5 text-popover-foreground shadow-[var(--shadow-sheet)] animate-in fade-in-0 zoom-in-95 duration-150"
        >
            {SIDEKICK_ACTIONS.map((action) => (
                <Button
                    key={action.name}
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={readOnly && action.edits}
                    title={readOnly && action.edits ? "This document is view-only" : action.hint}
                    data-testid={`sidekick-sel-${action.name}`}
                    onClick={() => {
                        setUsedFor(place.key)
                        void ACTIONS[action.name]({ blockId: place.blockId, whole: place.whole })
                    }}
                    className="text-ink-soft hover:text-ink"
                >
                    <action.icon />
                    {action.label}
                </Button>
            ))}
        </div>,
        document.body
    )
}
