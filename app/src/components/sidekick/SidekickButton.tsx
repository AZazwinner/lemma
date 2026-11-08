"use client"

import { useEffect, useId, useRef, useState } from "react"
import { Camera, CornerDownLeft, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tip } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { isWorking, loadStatus, resetSidekick, setCollab, setDocId, setMenuOpen, setReadOnly } from "@/lib/sidekick"
import { ACTIONS, write } from "@/lib/sidekick-actions"
import { photoToLatex } from "@/lib/sidekick-photo"
import { ACCEPTED_TYPES } from "@/lib/sidekick-image"
import { SIDEKICK_ACTIONS } from "./action-list"
import { useSidekick } from "./useSidekick"

// The sparkle in the top bar: the same four actions as the toolbar that appears beside a selection, plus "Write from
// description". It stays closed until clicked and never opens by itself. Its buttons keep the editor's focus (mousedown is
// not allowed to move it), so the writer's caret and selection are not disturbed; only the text field takes it, because
// the writer clicked into it. What the actions produce appears inline, under the block, not here.
const keepEditorFocus = (e: React.MouseEvent) => {
    if (!(e.target instanceof HTMLInputElement)) e.preventDefault()
}

export function SidekickButton({ docId, readOnly = false }: { docId: number; readOnly?: boolean }) {
    const s = useSidekick()
    const rootRef = useRef<HTMLDivElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const [draft, setDraft] = useState("")
    const fieldId = useId()

    useEffect(() => {
        void loadStatus()
        return () => resetSidekick()
    }, [])

    useEffect(() => {
        setDocId(docId)
    }, [docId])

    useEffect(() => {
        setReadOnly(readOnly)
    }, [readOnly])

    // A click anywhere else closes the menu. It does not stop the click, so the editor still gets it.
    useEffect(() => {
        if (!s.menuOpen) return
        const onDown = (e: MouseEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) setMenuOpen(false)
        }
        document.addEventListener("mousedown", onDown)
        return () => document.removeEventListener("mousedown", onDown)
    }, [s.menuOpen])

    if (s.availability !== "ready" && s.availability !== "off") return null

    const off = s.availability === "off"
    const working = isWorking(s)
    const hasBlock = s.activeBlockId !== null
    const collab = s.collab && !readOnly

    const run = (name: (typeof SIDEKICK_ACTIONS)[number]["name"]) => {
        setMenuOpen(false)
        void ACTIONS[name]()
    }

    const submit = () => {
        const text = draft.trim()
        if (!text) return
        setDraft("")
        setMenuOpen(false)
        void write(text)
    }

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
            <Tip label="Sidekick">
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={working ? "Sidekick is working" : "Sidekick"}
                    aria-expanded={s.menuOpen}
                    aria-haspopup="true"
                    aria-busy={working}
                    data-testid="sidekick-button"
                    data-anim="tilt"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setMenuOpen(!s.menuOpen)}
                    className={cn("text-ink-faint hover:text-ink", s.menuOpen && "bg-tint text-ink", off && "opacity-60")}
                >
                    <Sparkles className={cn("h-4 w-4", working && "animate-pulse text-foreground")} />
                </Button>
            </Tip>

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
                    {off ? (
                        <p data-testid="sidekick-off" className="px-2.5 py-2 text-[0.84rem] leading-snug text-ink-soft">
                            Sidekick is switched off on this server.
                        </p>
                    ) : (
                        <>
                            <p className="px-2.5 pb-0.5 pt-1 text-xs leading-snug text-ink-faint">
                                {hasBlock ? "On your selection, or the block you're in." : "Click into a block first, or select some text."}
                            </p>
                            {SIDEKICK_ACTIONS.map((action, i) => (
                                <MenuItem
                                    key={action.name}
                                    index={i}
                                    icon={<action.icon className="size-4" />}
                                    title={action.label}
                                    hint={action.hint}
                                    disabled={!hasBlock || (readOnly && action.edits)}
                                    onClick={() => run(action.name)}
                                />
                            ))}

                            <div className="mt-1.5 border-t border-hairline-soft pt-1.5">
                                <form
                                    className="px-2.5 pb-1.5"
                                    onSubmit={(e) => {
                                        e.preventDefault()
                                        submit()
                                    }}
                                >
                                    <label htmlFor={fieldId} className="block pb-1 text-xs font-medium text-ink-soft">
                                        Write from description
                                    </label>
                                    <div className="flex items-center gap-1.5">
                                        <input
                                            id={fieldId}
                                            value={draft}
                                            onChange={(e) => setDraft(e.target.value)}
                                            maxLength={2000}
                                            disabled={readOnly}
                                            placeholder="e.g. a proof that there are infinitely many primes"
                                            data-testid="sidekick-write-input"
                                            className="h-8 min-w-0 flex-1 rounded-lg border border-hairline bg-sheet px-2.5 text-[0.84rem] text-ink outline-none transition-colors placeholder:text-ink-faint focus-visible:border-ring disabled:opacity-50"
                                        />
                                        <Button
                                            type="submit"
                                            variant="outline"
                                            size="icon"
                                            aria-label="Write it"
                                            data-testid="sidekick-write-submit"
                                            disabled={!draft.trim() || readOnly}
                                        >
                                            <CornerDownLeft />
                                        </Button>
                                    </div>
                                    {collab && <p className="pt-1 text-xs leading-snug text-ink-faint">Sidekick adds it to the document as new blocks.</p>}
                                </form>
                                <MenuItem
                                    index={SIDEKICK_ACTIONS.length}
                                    icon={<Camera className="size-4" />}
                                    title="Photo → LaTeX"
                                    hint="Read the maths in a picture"
                                    disabled={!hasBlock || readOnly}
                                    onClick={() => {
                                        setMenuOpen(false)
                                        fileInputRef.current?.click()
                                    }}
                                />
                            </div>

                            <div className="mt-1.5 flex flex-col gap-0.5 border-t border-hairline-soft pt-1">
                                {!readOnly && <CollabSwitch on={s.collab} />}
                                <p className="px-2.5 pb-1 pt-0.5 text-xs leading-snug text-ink-faint">
                                    {s.mock && <span className="mr-1.5 rounded bg-tint px-1.5 py-px font-medium text-ink-soft">Demo mode</span>}
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
        </div>
    )
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
            className="flex w-full items-center justify-between gap-3.5 rounded-lg px-2.5 py-1.5 text-left outline-none transition-colors hover:bg-tint focus-visible:bg-tint"
        >
            <span className="flex flex-col gap-px">
                <span className="text-[0.84rem] font-medium leading-tight text-ink">Join as a collaborator</span>
                <span className="text-[0.78rem] leading-snug text-ink-faint">Writes into the document, for everyone</span>
            </span>
            <span aria-hidden className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200", on ? "bg-primary" : "bg-ink-faint/40")}>
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
            className="sk-item group flex w-full items-center gap-3 rounded-lg px-2.5 py-1 text-left outline-none transition-colors hover:bg-tint focus-visible:bg-tint disabled:pointer-events-none disabled:opacity-50"
        >
            <span className="inline-flex size-[26px] shrink-0 items-center justify-center rounded-lg bg-muted text-ink-soft transition-colors duration-150 group-hover:bg-sheet group-hover:text-ink group-focus-visible:bg-sheet">
                {icon}
            </span>
            <span className="flex min-w-0 flex-col gap-px">
                <span className="text-[0.84rem] font-medium leading-tight text-ink">{title}</span>
                <span className="text-[0.78rem] leading-snug text-ink-faint">{hint}</span>
            </span>
        </button>
    )
}
