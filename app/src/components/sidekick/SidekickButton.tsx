"use client"

import { useEffect, useRef, useSyncExternalStore } from "react"
import { ArrowRight, CircleAlert, Clock, Info, ListChecks, Sigma, Sparkles, Wrench, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
    convertToLatex,
    dismissNotice,
    explainEquation,
    getServerState,
    getState,
    insertExplanation,
    loadStatus,
    resetSidekick,
    setCollab,
    setDocId,
    setMenuOpen,
    subscribe,
} from "@/lib/sidekick"
import { applyCheckSuggestion, checkMyWork, fixLatexError, suggestNextStep } from "@/lib/sidekick-math"

// A small icon beside the collaborators' avatars. Closed until clicked; it never opens by itself and its buttons keep
// the editor's focus (mousedown is not allowed to move it), so the writer's caret and typing are never disturbed.
const keepEditorFocus = (e: React.MouseEvent) => e.preventDefault()

export function SidekickButton({ docId, readOnly = false }: { docId: number; readOnly?: boolean }) {
    const s = useSyncExternalStore(subscribe, getState, getServerState)
    const rootRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        void loadStatus()
        return () => resetSidekick()
    }, [])

    useEffect(() => {
        setDocId(docId)
    }, [docId])

    // A click anywhere else closes the menu. It does not stop the click, so the editor still gets it.
    useEffect(() => {
        if (!s.menuOpen) return
        const onDown = (e: MouseEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) setMenuOpen(false)
        }
        document.addEventListener("mousedown", onDown)
        return () => document.removeEventListener("mousedown", onDown)
    }, [s.menuOpen])

    if (s.availability !== "ready") return null

    const working = s.working !== null
    const collab = s.collab && !readOnly
    const label = working ? "Sidekick is working" : "Sidekick"

    return (
        <div
            ref={rootRef}
            className="relative"
            onKeyDown={(e) => {
                if (e.key === "Escape" && s.menuOpen) {
                    e.stopPropagation()
                    setMenuOpen(false)
                }
            }}
        >
            <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={label}
                aria-expanded={s.menuOpen}
                aria-haspopup="true"
                aria-busy={working}
                title={s.mock ? "Sidekick (demo mode: canned answers)" : "Sidekick"}
                data-testid="sidekick-button"
                onMouseDown={keepEditorFocus}
                onClick={() => setMenuOpen(!s.menuOpen)}
                className="text-muted-foreground"
            >
                <Sparkles className={cn("h-4 w-4", working && "animate-pulse text-foreground")} />
            </Button>

            {s.menuOpen && (
                <div
                    data-testid="sidekick-panel"
                    onMouseDown={keepEditorFocus}
                    className="absolute right-0 top-full z-50 mt-1.5 max-h-[calc(100vh-5rem)] w-80 overflow-y-auto rounded-lg bg-popover p-1.5 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10"
                >
                    {s.check || s.working === "check" ? (
                        <CheckCard readOnly={readOnly} />
                    ) : s.explanation || s.working === "explain" ? (
                        <ExplanationCard readOnly={readOnly} />
                    ) : (
                        <>
                            <GroupLabel>Write</GroupLabel>
                            <MenuItem
                                icon={<Sigma className="h-4 w-4" />}
                                title="Describe → LaTeX"
                                hint={
                                    collab
                                        ? "Sidekick adds the equation as a new block below"
                                        : "Turns your selection, or this block, into an equation"
                                }
                                disabled={readOnly || working}
                                onClick={() => void convertToLatex()}
                            />
                            <MenuItem
                                icon={<Sparkles className="h-4 w-4" />}
                                title="Explain this equation"
                                hint={collab ? "Sidekick adds the explanation as a new block below" : "Plain language, step by step"}
                                disabled={working}
                                onClick={() => void explainEquation()}
                            />
                            <GroupLabel>Math help</GroupLabel>
                            <MenuItem
                                icon={<Wrench className="h-4 w-4" />}
                                title="Fix LaTeX error"
                                hint="Finds an equation that won't render and suggests a repair"
                                disabled={readOnly || working}
                                onClick={() => void fixLatexError()}
                            />
                            <MenuItem
                                icon={<ListChecks className="h-4 w-4" />}
                                title="Check my work"
                                hint="Marks the first step that doesn't follow, one step per line"
                                disabled={working}
                                onClick={() => void checkMyWork()}
                            />
                            <MenuItem
                                icon={<ArrowRight className="h-4 w-4" />}
                                title="Suggest next step"
                                hint="A ghost line after your last step"
                                disabled={readOnly || working}
                                onClick={() => void suggestNextStep()}
                            />
                            {!readOnly && <CollabSwitch on={s.collab} />}
                            <p className="px-2 pb-1 pt-1.5 text-xs text-muted-foreground">
                                {s.mock ? "Demo mode: canned answers, no AI called. " : ""}
                                {s.usedToday !== null && s.dailyBudget !== null && !s.mock
                                    ? `${s.usedToday} of ${s.dailyBudget} requests used today. `
                                    : ""}
                                Only runs when you ask.
                            </p>
                        </>
                    )}
                </div>
            )}

            {s.notice && !s.menuOpen && (
                <div
                    role="status"
                    aria-live="polite"
                    data-testid="sidekick-notice"
                    onMouseDown={keepEditorFocus}
                    className="absolute right-0 top-full z-50 mt-1.5 flex w-max max-w-64 items-start gap-1.5 rounded-md bg-popover px-2.5 py-1.5 text-xs text-muted-foreground shadow-sm ring-1 ring-foreground/10"
                >
                    {s.notice.kind === "busy" ? (
                        <Clock className="mt-px h-3.5 w-3.5 shrink-0" />
                    ) : s.notice.kind === "info" ? (
                        <Info className="mt-px h-3.5 w-3.5 shrink-0" />
                    ) : (
                        <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
                    )}
                    <span>{s.notice.text}</span>
                    <button type="button" aria-label="Dismiss" onClick={dismissNotice} className="-mr-0.5 shrink-0 hover:text-foreground">
                        <X className="h-3 w-3" />
                    </button>
                </div>
            )}
        </div>
    )
}

function GroupLabel({ children }: { children: React.ReactNode }) {
    return <p className="px-2 pb-0.5 pt-1.5 text-[0.68rem] font-medium uppercase tracking-wide text-muted-foreground/80">{children}</p>
}

// Off by default: answers are private suggestions you accept. On, the Sidekick joins the document like another person.
function CollabSwitch({ on }: { on: boolean }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={on}
            data-testid="sidekick-collab-switch"
            onClick={() => setCollab(!on)}
            className="mt-1 flex w-full items-center justify-between gap-3 rounded-md border-t px-2 py-2 text-left hover:bg-accent/50"
        >
            <span className="flex flex-col">
                <span className="text-[0.82rem] font-medium leading-tight">Join as a collaborator</span>
                <span className="text-xs leading-snug text-muted-foreground">
                    Writes into the document and shows to everyone, instead of suggesting
                </span>
            </span>
            <span
                aria-hidden
                className={cn(
                    "relative h-4 w-7 shrink-0 rounded-full transition-colors",
                    on ? "bg-primary" : "bg-muted-foreground/30"
                )}
            >
                <span
                    className={cn(
                        "absolute top-0.5 h-3 w-3 rounded-full bg-background transition-all",
                        on ? "left-[0.875rem]" : "left-0.5"
                    )}
                />
            </span>
        </button>
    )
}

function MenuItem({
    icon,
    title,
    hint,
    disabled,
    onClick,
}: {
    icon: React.ReactNode
    title: string
    hint: string
    disabled?: boolean
    onClick: () => void
}) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            className="flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
        >
            <span className="mt-0.5 text-muted-foreground">{icon}</span>
            <span className="flex flex-col">
                <span className="font-medium leading-tight">{title}</span>
                <span className="text-xs leading-snug text-muted-foreground">{hint}</span>
            </span>
        </button>
    )
}

function ExplanationCard({ readOnly }: { readOnly: boolean }) {
    const s = useSyncExternalStore(subscribe, getState, getServerState)
    const e = s.explanation

    return (
        <div data-testid="sidekick-explanation" className="flex flex-col gap-2 p-1.5">
            {!e ? (
                <p className="text-xs text-muted-foreground" aria-live="polite">
                    Working it out…
                </p>
            ) : (
                <>
                    <p className="leading-snug">{e.summary}</p>
                    {e.steps.length > 0 && (
                        <ol className="max-h-56 list-decimal space-y-1 overflow-y-auto pl-5 text-[0.82rem] leading-snug text-muted-foreground marker:text-muted-foreground/70">
                            {e.steps.map((step, i) => (
                                <li key={i}>{step}</li>
                            ))}
                        </ol>
                    )}
                    <div className="flex items-center justify-between gap-2 pt-0.5">
                        <span className="text-xs text-muted-foreground">{e.mock ? "Demo answer" : "Esc to close"}</span>
                        <div className="flex gap-1">
                            {!readOnly && (
                                <Button type="button" variant="ghost" size="xs" onClick={() => insertExplanation()}>
                                    Insert below
                                </Button>
                            )}
                            <Button type="button" variant="ghost" size="xs" onClick={() => setMenuOpen(false)}>
                                Close
                            </Button>
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}

function CheckCard({ readOnly }: { readOnly: boolean }) {
    const s = useSyncExternalStore(subscribe, getState, getServerState)
    const c = s.check

    return (
        <div data-testid="sidekick-check" className="flex flex-col gap-2 p-1.5">
            {!c ? (
                <p className="text-xs text-muted-foreground" aria-live="polite">
                    Reading your steps…
                </p>
            ) : (
                <>
                    <p className="font-medium leading-snug">
                        {c.ok
                            ? "Every step follows from the one before."
                            : c.stepNumber !== null
                              ? `Step ${c.stepNumber} doesn't follow.`
                              : "Something looks off."}
                    </p>
                    {c.stepText && !c.ok && (
                        <p className="rounded-md bg-muted px-2 py-1 font-mono text-xs leading-snug break-words">{c.stepText}</p>
                    )}
                    {c.why && <p className="text-[0.82rem] leading-snug text-muted-foreground">{c.why}</p>}
                    {c.suggestion && !c.ok && (
                        <p className="text-[0.82rem] leading-snug text-muted-foreground">
                            Try: <span className="font-mono text-xs text-foreground">{c.suggestion}</span>
                        </p>
                    )}
                    <div className="flex items-center justify-between gap-2 pt-0.5">
                        <span className="text-xs text-muted-foreground">{c.mock ? "Demo answer" : "Esc to close"}</span>
                        <div className="flex gap-1">
                            {!readOnly && c.suggestion && c.stepRange && !c.ok && (
                                <Button type="button" variant="ghost" size="xs" onClick={() => applyCheckSuggestion()}>
                                    Use suggestion
                                </Button>
                            )}
                            <Button type="button" variant="ghost" size="xs" onClick={() => setMenuOpen(false)}>
                                Close
                            </Button>
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}
