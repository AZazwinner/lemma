"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { ChevronRight, X } from "lucide-react"
import katex from "katex"
import "katex/contrib/mhchem"
import { Button } from "@/components/ui/button"
import { MathText } from "@/components/sidekick/MathText"
import { cn } from "@/lib/utils"
import { headingAt, outlineRows, type Heading, type Outline, type OutlineEquation, type OutlineRow } from "@/lib/doc-outline"
import { blockAtReadingLine, flash, locate, scrollToElement, type OutlineTarget } from "./goTo"
import type { OutlinePanelState } from "./useOutlinePanel"

const NONE: ReadonlySet<string> = new Set()

type Props = {
    state: OutlinePanelState
    outline: Outline
    /** The ids of the document's blocks, in order. */
    blockIds: readonly string[]
    /** The block the cursor is in, or was last in. */
    focusedBlockId: string | null
    /** The scrolling page the document is drawn in. */
    containerRef: RefObject<HTMLDivElement | null>
}

/**
 * The document outline: its headings, indented by level and collapsible, and under them the equations that show a number in
 * the margin. On a wide screen it sits beside the page; on a narrow one it is a drawer over it.
 *
 * It stays mounted while closed, so collapsed sections are still collapsed when it is opened again.
 */
export function OutlinePanel({ state, outline, blockIds, focusedBlockId, containerRef }: Props) {
    const { open, setOpen, narrow } = state
    const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(NONE)
    const [tabStop, setTabStop] = useState<string | null>(null)
    const treeRef = useRef<HTMLDivElement | null>(null)

    // The current section follows the most recent of two things: the cursor moving into a block, and the page being scrolled.
    // Either way it is a block, and the section is the last heading at or above it.
    const [anchor, setAnchor] = useState<string | null>(null)
    const [seenFocus, setSeenFocus] = useState(focusedBlockId)
    if (seenFocus !== focusedBlockId) {
        setSeenFocus(focusedBlockId)
        if (focusedBlockId) setAnchor(focusedBlockId)
    }
    // While the page is scrolling to a heading that was clicked, the scrolling itself must not move the highlight along the way.
    // That lasts until the browser says the scroll has ended, or a second and a half if it never does.
    const scrollingToTarget = useRef(false)
    const settleTimer = useRef(0)

    useEffect(() => {
        const container = containerRef.current
        if (!open || !container) return
        let frame = 0
        let first = true
        const update = () => {
            frame = 0
            const isFirst = first
            first = false
            if (!isFirst && scrollingToTarget.current) return
            const at = blockAtReadingLine(container)
            // opening the panel only fills in a section when the cursor has not already chosen one
            setAnchor((before) => (isFirst ? (before ?? at) : at))
        }
        const onScroll = () => {
            if (!frame) frame = requestAnimationFrame(update)
        }
        const onScrollEnd = () => {
            window.clearTimeout(settleTimer.current)
            scrollingToTarget.current = false
        }
        container.addEventListener("scroll", onScroll, { passive: true })
        container.addEventListener("scrollend", onScrollEnd)
        onScroll()
        return () => {
            container.removeEventListener("scroll", onScroll)
            container.removeEventListener("scrollend", onScrollEnd)
            cancelAnimationFrame(frame)
            window.clearTimeout(settleTimer.current)
            scrollingToTarget.current = false
        }
    }, [open, containerRef])

    const go = useCallback(
        (target: OutlineTarget) => {
            const container = containerRef.current
            const element = container ? locate(container, target) : null
            if (!container || !element) return
            setAnchor(target.blockId)
            if (narrow) setOpen(false) // the drawer is in the way of what was asked for
            window.clearTimeout(settleTimer.current)
            scrollingToTarget.current = scrollToElement(container, element)
            if (scrollingToTarget.current) {
                settleTimer.current = window.setTimeout(() => {
                    scrollingToTarget.current = false
                }, 1500)
            }
            flash(element)
        },
        [containerRef, narrow, setOpen]
    )
    const goHeading = useCallback((heading: Heading) => go({ blockId: heading.blockId, kind: "heading", ordinal: heading.ordinal }), [go])
    const goEquation = useCallback((equation: OutlineEquation) => go({ blockId: equation.blockId, kind: "equation", ordinal: equation.ordinal }), [go])

    const toggle = useCallback((id: string) => {
        setCollapsed((before) => {
            const next = new Set(before)
            if (!next.delete(id)) next.add(id)
            return next
        })
    }, [])

    const rows = useMemo(() => outlineRows(outline.headings, collapsed), [outline.headings, collapsed])
    const activeId = useMemo(() => headingAt(outline.headings, blockIds, anchor), [outline.headings, blockIds, anchor])

    // If the current section is inside a collapsed one, the collapsed heading that holds it is lit instead.
    const shownActive = useMemo(() => {
        if (!activeId) return null
        const visible = new Set(rows.map((r) => r.heading.id))
        const parentOf = new Map(outlineRows(outline.headings, NONE).map((r) => [r.heading.id, r.parentId]))
        let id: string | null = activeId
        while (id && !visible.has(id)) id = parentOf.get(id) ?? null
        return id
    }, [activeId, rows, outline.headings])

    const tabbableId = rows.some((r) => r.heading.id === tabStop) ? tabStop : (shownActive ?? rows[0]?.heading.id ?? null)

    const focusRow = (row: OutlineRow | undefined) => {
        if (!row) return
        setTabStop(row.heading.id)
        treeRef.current?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(row.heading.id)}"]`)?.focus()
    }

    const onTreeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const item = (event.target as HTMLElement).closest<HTMLElement>("[data-row-id]")
        if (!item) return
        const index = rows.findIndex((r) => r.heading.id === item.dataset.rowId)
        const row = rows[index]
        if (!row) return
        switch (event.key) {
            case "ArrowDown":
                focusRow(rows[index + 1])
                break
            case "ArrowUp":
                focusRow(rows[index - 1])
                break
            case "Home":
                focusRow(rows[0])
                break
            case "End":
                focusRow(rows[rows.length - 1])
                break
            case "ArrowRight":
                if (row.hasChildren && row.collapsed) toggle(row.heading.id)
                else if (row.hasChildren) focusRow(rows[index + 1])
                break
            case "ArrowLeft":
                if (row.hasChildren && !row.collapsed) toggle(row.heading.id)
                else focusRow(rows.find((r) => r.heading.id === row.parentId))
                break
            case "Enter":
            case " ":
                goHeading(row.heading)
                break
            default:
                return
        }
        event.preventDefault()
    }

    const body = (
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-2 pb-6 pt-3" data-testid="outline-body">
            <section aria-labelledby="outline-headings">
                <h2 id="outline-headings" className="px-2 pb-1 text-[0.7rem] font-medium uppercase tracking-wider text-ink-faint">
                    Outline
                </h2>
                {rows.length === 0 ? (
                    <p className="px-2 py-1 text-sm text-ink-faint" data-testid="outline-empty">
                        Headings you add to the document will appear here.
                    </p>
                ) : (
                    <div
                        ref={treeRef}
                        role="tree"
                        aria-labelledby="outline-headings"
                        onKeyDown={onTreeKeyDown}
                        onFocus={(event) => {
                            const id = (event.target as HTMLElement).closest<HTMLElement>("[data-row-id]")?.dataset.rowId
                            if (id) setTabStop(id)
                        }}
                        className="flex flex-col gap-px"
                    >
                        {rows.map((row) => (
                            <HeadingRow
                                key={row.heading.id}
                                heading={row.heading}
                                depth={row.depth}
                                hasChildren={row.hasChildren}
                                collapsed={row.collapsed}
                                current={row.heading.id === shownActive}
                                tabbable={row.heading.id === tabbableId}
                                onGo={goHeading}
                                onToggle={toggle}
                            />
                        ))}
                    </div>
                )}
            </section>

            <section aria-labelledby="outline-equations">
                <h2 id="outline-equations" className="px-2 pb-1 text-[0.7rem] font-medium uppercase tracking-wider text-ink-faint">
                    Equations
                </h2>
                {outline.equations.length === 0 ? (
                    <p className="px-2 py-1 text-sm text-ink-faint" data-testid="outline-equations-empty">
                        Equations that show a number in the margin will appear here.
                    </p>
                ) : (
                    <ul className="flex flex-col gap-px" data-testid="outline-equations">
                        {outline.equations.map((equation) => (
                            <li key={equation.id}>
                                <EquationRow equation={equation} onGo={goEquation} />
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    )

    if (!open) return null

    if (narrow) {
        return (
            <DialogPrimitive.Root open onOpenChange={setOpen}>
                <DialogPrimitive.Portal>
                    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgba(20,26,36,0.28)] duration-200 dark:bg-black/45 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
                    <DialogPrimitive.Content
                        id="doc-outline"
                        data-testid="outline-drawer"
                        aria-describedby={undefined}
                        // Radix would hand focus back to a Dialog.Trigger, and there is none: the page's own toggle button opens this.
                        onCloseAutoFocus={(event) => {
                            event.preventDefault()
                            state.triggerRef.current?.focus()
                        }}
                        className="fixed inset-y-0 left-0 z-50 flex w-[min(20rem,85vw)] flex-col border-r border-hairline bg-sheet shadow-[var(--shadow-sheet)] outline-hidden duration-200 data-open:animate-in data-open:slide-in-from-left data-closed:animate-out data-closed:slide-out-to-left"
                    >
                        <div className="flex items-center justify-between border-b border-hairline-soft px-3 py-2">
                            <DialogPrimitive.Title className="text-sm font-medium text-ink">Document outline</DialogPrimitive.Title>
                            <DialogPrimitive.Close asChild>
                                <Button variant="ghost" size="icon-sm" aria-label="Close outline" className="text-ink-soft">
                                    <X className="h-4 w-4" />
                                </Button>
                            </DialogPrimitive.Close>
                        </div>
                        {body}
                    </DialogPrimitive.Content>
                </DialogPrimitive.Portal>
            </DialogPrimitive.Root>
        )
    }

    return (
        <aside id="doc-outline" aria-label="Document outline" data-testid="outline-panel" className="flex w-64 shrink-0 flex-col border-r border-hairline-soft bg-sheet print:hidden">
            {body}
        </aside>
    )
}

// ---- rows --------------------------------------------------------------------------------------------------------------

type HeadingRowProps = {
    heading: Heading
    depth: number
    hasChildren: boolean
    collapsed: boolean
    current: boolean
    tabbable: boolean
    onGo: (heading: Heading) => void
    onToggle: (id: string) => void
}

// A row is redrawn only when something about it changed: headings that did not change are the same objects from one outline to
// the next, and the callbacks are stable.
const HeadingRow = memo(function HeadingRow({ heading, depth, hasChildren, collapsed, current, tabbable, onGo, onToggle }: HeadingRowProps) {
    return (
        <div
            role="treeitem"
            data-row-id={heading.id}
            data-testid="outline-heading"
            aria-level={depth + 1}
            aria-expanded={hasChildren ? !collapsed : undefined}
            aria-selected={current}
            aria-current={current ? "location" : undefined}
            tabIndex={tabbable ? 0 : -1}
            onClick={() => onGo(heading)}
            style={{ paddingLeft: `${0.25 + depth * 0.875}rem` }}
            className={cn(
                "flex cursor-pointer items-center gap-0.5 rounded-md py-1 pr-2 text-sm outline-none transition-colors",
                "hover:bg-tint hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/50",
                current ? "bg-tint font-medium text-ink" : depth === 0 ? "text-ink" : "text-ink-soft"
            )}
        >
            {/* Mouse only: from the keyboard, Left and Right do the same. */}
            <span
                aria-hidden
                data-testid="outline-chevron"
                onClick={(event) => {
                    event.stopPropagation()
                    if (hasChildren) onToggle(heading.id)
                }}
                className="flex size-5 shrink-0 items-center justify-center rounded text-ink-faint hover:text-ink"
            >
                {hasChildren && <ChevronRight className={cn("size-3.5 transition-transform duration-150", !collapsed && "rotate-90")} />}
            </span>
            <span className="min-w-0 flex-1 truncate">
                <MathText text={heading.text} className="font-sans" />
            </span>
        </div>
    )
})

const EquationRow = memo(function EquationRow({ equation, onGo }: { equation: OutlineEquation; onGo: (equation: OutlineEquation) => void }) {
    return (
        <button
            type="button"
            data-testid="outline-equation"
            onClick={() => onGo(equation)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-ink-soft outline-none transition-colors hover:bg-tint hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/50"
        >
            <span className="w-9 shrink-0 font-serif tabular-nums text-ink-faint">({equation.number})</span>
            {/* One line: what does not fit is cut off with a fade, not wrapped. */}
            <span
                className="min-w-0 flex-1 overflow-hidden whitespace-nowrap [mask-image:linear-gradient(to_right,#000_calc(100%-1.25rem),transparent)]"
                dangerouslySetInnerHTML={{ __html: previewHtml(equation.tex) }}
            />
        </button>
    )
})

// ---- the small typeset preview of an equation ----------------------------------------------------------------------------

const previews = new Map<string, string>()

function escapeHtml(text: string): string {
    return text.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch] as string)
}

/**
 * The equation typeset inline, as KaTeX's own HTML (KaTeX's `trust` stays off, so it contains no links or scripts). The
 * margin number belongs next to it, not inside it, so `\label` and `\notag` are dropped.
 */
function previewHtml(tex: string): string {
    const cached = previews.get(tex)
    if (cached !== undefined) return cached
    const clean = tex
        .replace(/\\label\s*\{[^{}]*\}/g, "")
        .replace(/\\(?:notag|nonumber)\b/g, "")
        .replace(/\s+/g, " ")
        .trim()
    let html: string
    try {
        html = katex.renderToString(clean, { throwOnError: false, strict: "ignore", displayMode: false })
    } catch {
        html = escapeHtml(clean)
    }
    if (previews.size > 300) previews.clear()
    previews.set(tex, html)
    return html
}
