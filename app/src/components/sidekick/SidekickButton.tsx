"use client"

import { useEffect, useRef, useSyncExternalStore } from "react"
import { ArrowRight, Camera, CircleAlert, Clock, Info, ListChecks, Sigma, Sparkles, Wrench, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DrawnCheck, UnitSpinner } from "@/components/ui/spinner"
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
import { photoToLatex } from "@/lib/sidekick-photo"
import { ACCEPTED_TYPES } from "@/lib/sidekick-image"

// A small icon beside the collaborators' avatars. Closed until clicked; it never opens by itself and its buttons keep
// the editor's focus (mousedown is not allowed to move it), so the writer's caret and typing are never disturbed.
const keepEditorFocus = (e: React.MouseEvent) => e.preventDefault()

export function SidekickButton({ docId, readOnly = false }: { docId: number; readOnly?: boolean }) {
    const s = useSyncExternalStore(subscribe, getState, getServerState)
    const rootRef = useRef<HTMLDivElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)

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
                data-anim="tilt"
                className={cn("text-ink-faint hover:text-ink", s.menuOpen && "bg-tint text-ink")}
            >
                <Sparkles className={cn("h-4 w-4", working && "animate-pulse text-foreground")} />
            </Button>

            <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_TYPES.join(",")}
                className="hidden"
                tabIndex={-1}
                aria-hidden
                data-testid="sidekick-photo-input"
                onChange={(e) => {
                    const file = e.target.files?.[0]
                    e.target.value = "" // so choosing the same file again still counts
                    if (file) void photoToLatex(file)
                }}
            />

            {s.menuOpen && (
                <div
                    data-testid="sidekick-panel"
                    onMouseDown={keepEditorFocus}
                    className="absolute right-0 top-full z-50 mt-1.5 max-h-[calc(100vh-5rem)] w-[22rem] max-w-[calc(100vw-2.5rem)] origin-top-right overflow-y-auto rounded-xl border border-hairline bg-popover p-1.5 text-sm text-popover-foreground shadow-[var(--shadow-sheet)] animate-in fade-in-0 zoom-in-95 duration-150"
                >
                    {s.check || s.working === "check" ? (
                        <CheckCard readOnly={readOnly} />
                    ) : s.explanation || s.working === "explain" ? (
                        <ExplanationCard readOnly={readOnly} />
                    ) : (
                        <>
                            <GroupLabel>Write</GroupLabel>
                            <MenuItem
                                index={0}
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
                                index={1}
                                icon={<Sparkles className="h-4 w-4" />}
                                title="Explain this equation"
                                hint={collab ? "Sidekick adds the explanation as a new block below" : "Plain language, step by step"}
                                disabled={working}
                                onClick={() => void explainEquation()}
                            />
                            <MenuItem
                                index={2}
                                icon={<Camera className="h-4 w-4" />}
                                title="Photo → LaTeX"
                                hint="Choose a picture of maths. It's shrunk in your browser first"
                                disabled={readOnly || working}
                                onClick={() => fileInputRef.current?.click()}
                            />
                            <GroupLabel>Math help</GroupLabel>
                            <MenuItem
                                index={3}
                                icon={<Wrench className="h-4 w-4" />}
                                title="Fix LaTeX error"
                                hint="Finds an equation that won't render and suggests a repair"
                                disabled={readOnly || working}
                                onClick={() => void fixLatexError()}
                            />
                            <MenuItem
                                index={4}
                                icon={<ListChecks className="h-4 w-4" />}
                                title="Check my work"
                                hint="Marks the first step that doesn't follow, one step per line"
                                disabled={working}
                                onClick={() => void checkMyWork()}
                            />
                            <MenuItem
                                index={5}
                                icon={<ArrowRight className="h-4 w-4" />}
                                title="Suggest next step"
                                hint="A ghost line after your last step"
                                disabled={readOnly || working}
                                onClick={() => void suggestNextStep()}
                            />
                            <div className="mt-1.5 flex flex-col gap-1.5 border-t border-hairline-soft pt-1.5">
                                {!readOnly && <CollabSwitch on={s.collab} />}
                                <p className="px-2.5 pb-1.5 pt-0.5 text-xs leading-relaxed text-ink-faint">
                                    {s.mock && (
                                        <>
                                            <span className="mr-1.5 rounded bg-tint px-1.5 py-px font-medium text-primary">
                                                Demo mode
                                            </span>
                                            Canned answers, no AI called.{" "}
                                        </>
                                    )}
                                    {s.usedToday !== null && s.dailyBudget !== null && !s.mock
                                        ? `${s.usedToday} of ${s.dailyBudget} requests used today. `
                                        : ""}
                                    Only runs when you ask.
                                </p>
                            </div>
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
                    className="mb-swap absolute right-0 top-full z-50 mt-1.5 flex w-max max-w-64 items-start gap-1.5 rounded-lg border border-hairline bg-popover px-2.5 py-1.5 text-xs leading-snug text-ink-soft shadow-[var(--shadow-sheet)]"
                >
                    {s.notice.kind === "busy" ? (
                        <Clock className="mt-px h-3.5 w-3.5 shrink-0 text-ink-faint" />
                    ) : s.notice.kind === "info" ? (
                        <Info className="mt-px h-3.5 w-3.5 shrink-0 text-ink-faint" />
                    ) : (
                        <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0 text-destructive" />
                    )}
                    <span>{s.notice.text}</span>
                    <button
                        type="button"
                        aria-label="Dismiss"
                        onClick={dismissNotice}
                        className="-mr-0.5 shrink-0 rounded text-ink-faint transition-colors hover:text-ink"
                    >
                        <X className="h-3 w-3" />
                    </button>
                </div>
            )}
        </div>
    )
}

function GroupLabel({ children }: { children: React.ReactNode }) {
    return <p className="px-2.5 pb-1 pt-2 text-xs font-medium text-ink-faint">{children}</p>
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
            className="flex w-full items-center justify-between gap-3.5 rounded-lg px-2.5 py-2 text-left outline-none transition-colors hover:bg-tint focus-visible:bg-tint"
        >
            <span className="flex flex-col gap-px">
                <span className="text-[0.84rem] font-medium leading-tight text-ink">Join as a collaborator</span>
                <span className="text-[0.78rem] leading-snug text-ink-faint">
                    Writes into the document and shows to everyone, instead of suggesting
                </span>
            </span>
            <span
                aria-hidden
                className={cn(
                    "relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200",
                    on ? "bg-primary" : "bg-ink-faint/40"
                )}
            >
                <span
                    className={cn(
                        "absolute left-0.5 top-0.5 size-4 rounded-full shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition-transform duration-300 ease-[var(--pop)]",
                        on ? "translate-x-4 bg-primary-foreground" : "translate-x-0 bg-sheet dark:bg-ink-soft"
                    )}
                />
            </span>
        </button>
    )
}

function MenuItem({
    index,
    icon,
    title,
    hint,
    disabled,
    onClick,
}: {
    index: number
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
            style={{ "--i": index } as React.CSSProperties}
            className="sk-item group flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left outline-none transition-colors hover:bg-tint focus-visible:bg-tint disabled:pointer-events-none disabled:opacity-50"
        >
            <span className="inline-flex size-[30px] shrink-0 items-center justify-center rounded-lg bg-muted text-ink-soft transition-colors duration-150 group-hover:bg-sheet group-hover:text-ink group-focus-visible:bg-sheet">
                {icon}
            </span>
            <span className="flex min-w-0 flex-col gap-px">
                <span className="text-[0.84rem] font-medium leading-tight text-ink">{title}</span>
                <span className="text-[0.78rem] leading-snug text-ink-faint">{hint}</span>
            </span>
        </button>
    )
}

function Working({ children }: { children: React.ReactNode }) {
    return (
        <p className="flex items-center gap-2 px-1 py-0.5 text-xs text-ink-faint" aria-live="polite">
            <UnitSpinner className="size-3.5" />
            {children}
        </p>
    )
}

function CardFoot({ mock, children }: { mock: boolean; children: React.ReactNode }) {
    return (
        <div className="flex items-center justify-between gap-2 pt-0.5">
            <span className="text-xs text-ink-faint">{mock ? "Demo answer" : "Esc to close"}</span>
            <div className="flex gap-1">{children}</div>
        </div>
    )
}

function ExplanationCard({ readOnly }: { readOnly: boolean }) {
    const s = useSyncExternalStore(subscribe, getState, getServerState)
    const e = s.explanation

    return (
        <div data-testid="sidekick-explanation" className="flex flex-col gap-2 p-1.5">
            {!e ? (
                <Working>Working it out…</Working>
            ) : (
                <>
                    <div className="mb-swap rounded-lg border border-hairline bg-tint px-3.5 pb-3 pt-2.5">
                        <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-primary">
                            <Sparkles className="size-3.5" aria-hidden />
                            Explanation
                        </p>
                        <p className="leading-snug text-ink">{e.summary}</p>
                        {e.steps.length > 0 && (
                            <ol className="mt-1.5 max-h-56 list-decimal space-y-1 overflow-y-auto pl-5 text-[0.82rem] leading-snug text-ink-soft marker:text-ink-faint">
                                {e.steps.map((step, i) => (
                                    <li key={i}>{step}</li>
                                ))}
                            </ol>
                        )}
                    </div>
                    <CardFoot mock={e.mock}>
                        {!readOnly && (
                            <Button type="button" variant="ghost" size="xs" onClick={() => insertExplanation()}>
                                Insert below
                            </Button>
                        )}
                        <Button type="button" variant="ghost" size="xs" onClick={() => setMenuOpen(false)}>
                            Close
                        </Button>
                    </CardFoot>
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
                <Working>Reading your steps…</Working>
            ) : (
                <>
                    <p className="mb-swap flex items-start gap-1.5 font-medium leading-snug text-ink">
                        {c.ok ? (
                            <DrawnCheck className="mt-0.5 size-3.5 text-ok" />
                        ) : (
                            <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden />
                        )}
                        <span>
                            {c.ok
                                ? "Every step follows from the one before."
                                : c.stepNumber !== null
                                  ? `Step ${c.stepNumber} doesn't follow.`
                                  : "Something looks off."}
                        </span>
                    </p>
                    {c.stepText && !c.ok && (
                        <p className="rounded-md bg-[var(--pencil-wash)] px-2 py-1.5 font-mono text-xs leading-snug break-words text-ink">
                            <span className="underline decoration-destructive decoration-wavy decoration-1 underline-offset-4">
                                {c.stepText}
                            </span>
                        </p>
                    )}
                    {c.why && <p className="text-[0.82rem] leading-snug text-ink-soft">{c.why}</p>}
                    {c.suggestion && !c.ok && (
                        <p className="text-[0.82rem] leading-snug text-ink-soft">
                            Try:{" "}
                            <span className="rounded bg-muted px-1.5 py-px font-mono text-xs text-ink">{c.suggestion}</span>
                        </p>
                    )}
                    <CardFoot mock={c.mock}>
                        {!readOnly && c.suggestion && c.stepRange && !c.ok && (
                            <Button type="button" variant="ghost" size="xs" onClick={() => applyCheckSuggestion()}>
                                Use suggestion
                            </Button>
                        )}
                        <Button type="button" variant="ghost" size="xs" onClick={() => setMenuOpen(false)}>
                            Close
                        </Button>
                    </CardFoot>
                </>
            )}
        </div>
    )
}
