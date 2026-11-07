"use client"

import { useEffect, useRef, useSyncExternalStore } from "react"
import { CircleAlert, Clock, Sigma, Sparkles, X } from "lucide-react"
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
    setMenuOpen,
    subscribe,
} from "@/lib/sidekick"

// A small icon beside the collaborators' avatars. Closed until clicked; it never opens by itself and its buttons keep
// the editor's focus (mousedown is not allowed to move it), so the writer's caret and typing are never disturbed.
const keepEditorFocus = (e: React.MouseEvent) => e.preventDefault()

export function SidekickButton({ readOnly = false }: { readOnly?: boolean }) {
    const s = useSyncExternalStore(subscribe, getState, getServerState)
    const rootRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        void loadStatus()
        return () => resetSidekick()
    }, [])

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
                    className="absolute right-0 top-full z-50 mt-1.5 w-72 rounded-lg bg-popover p-1.5 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10"
                >
                    {s.explanation || s.working === "explain" ? (
                        <ExplanationCard readOnly={readOnly} />
                    ) : (
                        <>
                            <MenuItem
                                icon={<Sigma className="h-4 w-4" />}
                                title="Describe → LaTeX"
                                hint="Turns your selection, or this block, into an equation"
                                disabled={readOnly || working}
                                onClick={() => void convertToLatex()}
                            />
                            <MenuItem
                                icon={<Sparkles className="h-4 w-4" />}
                                title="Explain this equation"
                                hint="Plain language, step by step"
                                disabled={working}
                                onClick={() => void explainEquation()}
                            />
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
