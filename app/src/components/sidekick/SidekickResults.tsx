"use client"

import { useLayoutEffect, useRef, useState } from "react"
import { ArrowRight, Camera, CircleAlert, Clock, Info, PenLine, Sparkles, Wrench, X } from "lucide-react"
import LatexRenderer from "@/components/LatexRenderer"
import { Button } from "@/components/ui/button"
import { DrawnCheck, UnitSpinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import {
    acceptPending,
    clearSlot,
    closeProposal,
    textAfterEdit,
    type ExplainSlot,
    type Proposal,
    type ProblemSlot,
    type SuggestionKind,
    type SuggestionSlot,
} from "@/lib/sidekick"
import { insertNote, proposeFix } from "@/lib/sidekick-actions"
import { explanationLines, type Notice } from "@/lib/sidekick-text"
import { MathText } from "./MathText"
import { useBlockSlots } from "./useSidekick"

// What the sidekick shows under a block: the explanation card, the one-line problem with its Fix button, and the dashed
// ghost block for a suggestion. They sit in the page's flow right under the block they are about, so they move with it, and
// they exist only on this person's screen. Buttons here keep the editor's focus: pressing one never moves the caret.

const keepFocus = (e: React.MouseEvent) => e.preventDefault()

export function SidekickResults({
    blockId,
    readOnly,
    focused,
    equationLabel,
}: {
    blockId: string
    readOnly: boolean
    /** True while the block's editor has the focus, which is when Tab and Esc reach the suggestion. */
    focused: boolean
    /** "(3)" for the n-th numbered equation of this block, which the explanation card names. */
    equationLabel: (eq: number | null) => string | null
}) {
    const slots = useBlockSlots(blockId)
    if (!slots) return null
    return (
        <div className="w-full max-w-4xl">
            {slots.problem && <Problem blockId={blockId} slot={slots.problem} focused={focused} />}
            {slots.explain && <Explanation blockId={blockId} slot={slots.explain} readOnly={readOnly} equationLabel={equationLabel} />}
            {slots.suggestion && <Suggestion blockId={blockId} slot={slots.suggestion} focused={focused} />}
        </div>
    )
}

// ---- small parts ---------------------------------------------------------------------------------------------------------

function Thinking() {
    return (
        <div
            role="status"
            aria-live="polite"
            data-sidekick-card
            data-testid="sidekick-thinking"
            className="mb-swap mx-10 my-1.5 flex items-center gap-2 text-[0.8rem] text-ink-faint"
        >
            <UnitSpinner className="size-3.5" />
            Thinking…
        </div>
    )
}

function NoticeRow({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
    const Icon = notice.kind === "busy" ? Clock : notice.kind === "info" ? Info : CircleAlert
    return (
        <div
            role="status"
            aria-live="polite"
            data-sidekick-card
            data-testid="sidekick-notice"
            className="mb-swap mx-10 my-1.5 flex items-start gap-2 rounded-lg border border-hairline bg-tint px-3 py-2 text-[0.82rem] leading-snug text-ink-soft"
        >
            <Icon className={cn("mt-0.5 size-3.5 shrink-0", notice.kind === "error" ? "text-pencil" : "text-ink-faint")} aria-hidden />
            <MathText text={notice.text} className="min-w-0 flex-1" />
            <DismissButton label="Dismiss" onClick={onDismiss} />
        </div>
    )
}

function DismissButton({ label, onClick }: { label: string; onClick: () => void }) {
    return (
        <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            data-testid="sidekick-close"
            onMouseDown={keepFocus}
            onClick={onClick}
            className="-my-0.5 shrink-0 text-ink-faint hover:text-ink"
        >
            <X />
        </Button>
    )
}

function Key({ children }: { children: React.ReactNode }) {
    return <kbd className="ml-1 rounded border border-hairline bg-sheet px-1 font-sans text-[0.68rem] font-normal leading-4 text-ink-soft">{children}</kbd>
}

// ---- explanation ---------------------------------------------------------------------------------------------------------

// A long explanation shows this many lines, and the rest is behind "Show more".
const FOLD_LINES = 3

/**
 * How tall the text may be to show exactly its first `lines` lines, or null if it has no more than that. Lines are found
 * from where the text is drawn, since typeset maths makes them different heights, so the fold never cuts a line in half.
 */
function foldHeight(root: HTMLElement, lines: number): number | null {
    const top = root.getBoundingClientRect().top
    const rects: DOMRect[] = []
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) =>
            node.parentElement?.closest(".katex-mathml") || !node.textContent?.trim() ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    })
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const range = document.createRange()
        range.selectNodeContents(node)
        for (const rect of range.getClientRects()) if (rect.height > 0) rects.push(rect)
    }
    rects.sort((a, b) => a.top - b.top)
    // a piece of text whose middle is below the bottom of the line so far starts the next line
    const bottoms: number[] = []
    for (const rect of rects) {
        const middle = (rect.top + rect.bottom) / 2
        if (bottoms.length === 0 || middle > bottoms[bottoms.length - 1]) bottoms.push(rect.bottom)
        else bottoms[bottoms.length - 1] = Math.max(bottoms[bottoms.length - 1], rect.bottom)
    }
    return bottoms.length > lines ? Math.ceil(bottoms[lines - 1] - top) + 3 : null
}

function Explanation({
    blockId,
    slot,
    readOnly,
    equationLabel,
}: {
    blockId: string
    slot: ExplainSlot
    readOnly: boolean
    equationLabel: (eq: number | null) => string | null
}) {
    if (slot.phase === "loading") return <Thinking />
    if (slot.phase === "notice") return <NoticeRow notice={slot.notice} onDismiss={() => clearSlot(blockId, "explain")} />
    const label = equationLabel(slot.eq)
    return (
        <section
            data-sidekick-card
            data-testid="sidekick-explanation"
            aria-label={label ? `Explanation of ${label}` : "Explanation"}
            className="mb-swap mx-10 mb-2 mt-1 rounded-lg border border-hairline bg-tint px-4 pb-3 pt-2.5"
        >
            <header className="mb-1.5 flex items-center gap-1.5 text-[0.8rem] font-medium text-ink-soft">
                <Sparkles className="size-3.5" aria-hidden />
                <h3 className="font-medium">{label ? `Explanation of ${label}` : "Explanation"}</h3>
                {slot.mock && <span className="rounded bg-sheet px-1.5 py-px text-[0.68rem] font-normal text-ink-faint">Demo</span>}
                <div className="ml-auto flex items-center gap-0.5">
                    {!readOnly && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            data-testid="sidekick-insert-note"
                            onMouseDown={keepFocus}
                            onClick={() => insertNote(blockId)}
                            className="text-ink-soft"
                        >
                            Insert as note
                        </Button>
                    )}
                    <DismissButton label="Dismiss explanation" onClick={() => clearSlot(blockId, "explain")} />
                </div>
            </header>
            <ExplanationText text={slot.text} />
        </section>
    )
}

/** The sentences with their maths typeset, folded to a few lines with "Show more" when they are long. */
function ExplanationText({ text }: { text: string }) {
    const [expanded, setExpanded] = useState(false)
    // Where the text is cut while folded; null when it is short enough to show whole.
    const [foldAt, setFoldAt] = useState<number | null>(null)
    const innerRef = useRef<HTMLDivElement>(null)

    useLayoutEffect(() => {
        const inner = innerRef.current
        if (!inner) return
        const measure = () => setFoldAt(foldHeight(inner, FOLD_LINES))
        measure()
        // typeset maths and web fonts arrive after the first paint and change the lines
        const observer = new ResizeObserver(measure)
        observer.observe(inner)
        return () => observer.disconnect()
    }, [text])

    const folded = foldAt !== null && !expanded
    return (
        <>
            <div className="overflow-hidden" style={folded ? { maxHeight: foldAt } : undefined}>
                <div ref={innerRef} className="text-[0.97rem] [&_p+p]:mt-1.5 [&_p]:my-0">
                    <LatexRenderer content={explanationLines(text).join("\n\n")} />
                </div>
            </div>
            {foldAt !== null && (
                <button
                    type="button"
                    data-testid="sidekick-show-more"
                    aria-expanded={expanded}
                    onMouseDown={keepFocus}
                    onClick={() => setExpanded((open) => !open)}
                    className="mt-1 text-[0.8rem] font-medium text-ink-soft underline-offset-2 hover:text-ink hover:underline"
                >
                    {expanded ? "Show less" : "Show more"}
                </button>
            )}
        </>
    )
}

// ---- a problem ---------------------------------------------------------------------------------------------------------------

function Problem({ blockId, slot, focused }: { blockId: string; slot: ProblemSlot; focused: boolean }) {
    if (slot.phase === "checking") return <Thinking />
    if (slot.phase === "notice") return <NoticeRow notice={slot.notice} onDismiss={() => clearSlot(blockId, "problem")} />
    if (slot.phase === "clean") {
        return (
            <div
                role="status"
                aria-live="polite"
                data-sidekick-card
                data-testid="sidekick-clean"
                className="mb-swap mx-10 my-1.5 flex items-center gap-2 text-[0.85rem] text-ink-soft"
            >
                <DrawnCheck className="size-3.5 text-ok" />
                <span className="min-w-0 flex-1">{slot.text}</span>
                <DismissButton label="Dismiss" onClick={() => clearSlot(blockId, "problem")} />
            </div>
        )
    }

    const canFix = slot.proposal.phase === "idle" && (slot.prepared !== null || slot.kind === "render")
    return (
        <>
            <div
                role="status"
                aria-live="polite"
                data-sidekick-card
                data-testid="sidekick-problem"
                className="mb-swap mx-10 my-1.5 flex items-start gap-2 text-[0.85rem] leading-snug"
            >
                <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-pencil" aria-hidden />
                <p className="min-w-0 flex-1">
                    <span className="font-medium text-pencil">{slot.message}</span>
                    {slot.detail && (
                        <>
                            {" "}
                            <MathText text={slot.detail} className="text-ink-soft" />
                        </>
                    )}
                </p>
                {canFix && (
                    <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        data-testid="sidekick-fix"
                        onMouseDown={keepFocus}
                        onClick={() => void proposeFix(blockId)}
                        className="-my-0.5 shrink-0"
                    >
                        <Wrench />
                        Fix
                    </Button>
                )}
                <DismissButton label="Dismiss" onClick={() => clearSlot(blockId, "problem")} />
            </div>
            {slot.proposal.phase === "loading" && <Thinking />}
            {slot.proposal.phase === "notice" && <NoticeRow notice={slot.proposal.notice} onDismiss={() => closeProposal(blockId)} />}
            {slot.proposal.phase === "ready" && (
                <Ghost
                    blockId={blockId}
                    source="problem"
                    proposal={slot.proposal.proposal}
                    icon={Wrench}
                    focused={focused}
                    onDismiss={() => closeProposal(blockId)}
                />
            )}
        </>
    )
}

// ---- a suggestion ------------------------------------------------------------------------------------------------------------

const SUGGESTION_ICONS: Record<SuggestionKind, typeof ArrowRight> = {
    next: ArrowRight,
    rewrite: PenLine,
    write: Sparkles,
    photo: Camera,
}

function Suggestion({ blockId, slot, focused }: { blockId: string; slot: SuggestionSlot; focused: boolean }) {
    if (slot.phase === "loading") return <Thinking />
    if (slot.phase === "notice") return <NoticeRow notice={slot.notice} onDismiss={() => clearSlot(blockId, "suggestion")} />
    return (
        <Ghost
            blockId={blockId}
            source="suggestion"
            proposal={slot.proposal}
            icon={SUGGESTION_ICONS[slot.kind]}
            focused={focused}
            onDismiss={() => clearSlot(blockId, "suggestion")}
        />
    )
}

/**
 * A dashed ghost block: the proposal drawn faded, with its maths typeset, and what it is, so the writer sees what will
 * happen before it does. Accepting is Tab or the button; dismissing is Esc or the button.
 */
function Ghost({
    blockId,
    source,
    proposal,
    icon: Icon,
    focused,
    onDismiss,
}: {
    blockId: string
    /** Which of the block's results this is, so Accept takes this one when there are two ghosts. */
    source: "suggestion" | "problem"
    proposal: Proposal
    icon: typeof ArrowRight
    focused: boolean
    onDismiss: () => void
}) {
    const preview = "snippet" in proposal.show ? proposal.show.snippet : textAfterEdit(blockId, proposal)
    return (
        <div
            role="group"
            aria-label={proposal.label}
            data-sidekick-card
            data-testid="sidekick-ghost"
            className="mb-swap mx-10 mb-2 mt-1 rounded-lg border border-dashed border-ink-faint/45 px-4 pb-2.5 pt-2"
        >
            {preview !== null && (
                <div
                    data-testid="sidekick-ghost-preview"
                    // a block is drawn as the block itself is (its line breaks kept); new text is Markdown and flows
                    className={cn("opacity-60 [&_.katex-display]:my-1.5", "block" in proposal.show && "whitespace-pre-wrap")}
                >
                    <LatexRenderer content={preview} />
                </div>
            )}
            {proposal.why && (
                <p className="mt-1 text-[0.82rem] leading-snug text-ink-soft">
                    <MathText text={proposal.why} />
                </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-tint px-2.5 py-0.5 text-[0.75rem] font-medium text-ink-soft">
                    <Icon className="size-3" aria-hidden />
                    {proposal.label}
                </span>
                <div className="ml-auto flex items-center gap-1">
                    <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        data-testid="sidekick-accept"
                        onMouseDown={keepFocus}
                        onClick={() => acceptPending(blockId, source)}
                    >
                        Accept
                        {focused && <Key>Tab</Key>}
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        data-testid="sidekick-dismiss"
                        onMouseDown={keepFocus}
                        onClick={onDismiss}
                        className="text-ink-soft"
                    >
                        Dismiss
                        {focused && <Key>Esc</Key>}
                    </Button>
                </div>
            </div>
        </div>
    )
}
