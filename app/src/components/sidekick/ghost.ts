import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view"
import { EditorState, type Extension, StateEffect, StateField } from "@codemirror/state"
import katex from "katex"
import { mentionAt, previewOf } from "@/lib/sidekick-text"

// Ghost text for the sidekick: a suggestion drawn after the text it would replace. It is a decoration, not part of the
// document, so nothing reaches the shared Yjs text until the user accepts it (Tab or a click). Esc, typing in the
// suggestion's range, or moving the cursor away throws it out.

export type GhostSuggestion = {
    /** The range accepting replaces. */
    from: number
    to: number
    /** What goes into the document. */
    insert: string
    /** A short preview shown as the ghost. */
    label: string
    /** Where the ghost is drawn. Defaults to the end of the range. */
    at?: number
    /**
     * The suggestion stays while the caret is anywhere in this range. Defaults to the replaced range. Suggestions that
     * insert a line (the next step) use the whole block, since the caret is rarely exactly where the line goes.
     */
    scope?: { from: number; to: number }
    /** How the ghost is drawn: a repaired equation with its render, or the next step on a line of its own. Looks only. */
    look?: GhostLook
}

export type GhostLook = "repair" | "next"

export type GhostState = { suggestion: GhostSuggestion | null; working: number | null }

export const setSuggestion = StateEffect.define<GhostSuggestion | null>()
/** `working` is the position the "working…" hint hangs from, or null for none. */
const setWorking = StateEffect.define<number | null>()

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)

class GhostWidget extends WidgetType {
    constructor(
        readonly text: string,
        readonly hint: string,
        readonly onClick: ((view: EditorView) => void) | null,
        readonly kind: "suggestion" | "working" | "hint",
        readonly look: GhostLook | null = null
    ) {
        super()
    }

    eq(other: GhostWidget) {
        return other.text === this.text && other.hint === this.hint && other.kind === this.kind && other.look === this.look
    }

    toDOM(view: EditorView) {
        const wrap = document.createElement("span")
        wrap.className = `cm-sidekick-ghost cm-sidekick-${this.kind}${this.look ? ` cm-sidekick-look-${this.look}` : ""}`
        wrap.setAttribute("aria-hidden", "true")
        wrap.setAttribute("data-sidekick-ghost", this.kind)

        if (this.look === "repair") {
            // The repaired LaTeX and how it renders, side by side.
            const code = document.createElement("code")
            code.textContent = this.text
            const render = document.createElement("span")
            render.className = "cm-sidekick-render"
            katex.render(this.text, render, { throwOnError: false, strict: "ignore" })
            wrap.append(chip(WRENCH, "Suggested repair"), code, render)
        } else if (this.look === "next") {
            const line = document.createElement("span")
            line.className = "cm-sidekick-line"
            line.textContent = this.text
            wrap.append(line, chip(ARROW, "Suggested next step"))
        } else {
            const label = document.createElement("span")
            label.textContent = this.text
            wrap.append(label)
        }

        if (this.hint) {
            const kbd = document.createElement("kbd")
            kbd.textContent = this.hint
            wrap.append(kbd)
        }

        if (this.onClick) {
            const handler = this.onClick
            // mousedown, not click: the editor must keep its focus and caret, and a click would arrive after it moved.
            wrap.addEventListener("mousedown", (event) => {
                event.preventDefault()
                event.stopPropagation()
                handler(view)
            })
        }
        return wrap
    }

    // CodeMirror leaves events on the widget alone, so clicking it never moves the caret.
    ignoreEvent() {
        return true
    }
}

// Lucide's wrench and arrow-right, at chip size.
const WRENCH =
    '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>'
const ARROW = '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>'

function chip(paths: string, text: string) {
    const el = document.createElement("span")
    el.className = "cm-sidekick-chip"
    el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`
    el.append(text)
    return el
}

export const ghostField =StateField.define<GhostState>({
    create: () => ({ suggestion: null, working: null }),
    update(value, tr) {
        let { suggestion, working } = value

        for (const effect of tr.effects) {
            if (effect.is(setSuggestion)) {
                suggestion = effect.value
                working = null
            } else if (effect.is(setWorking)) {
                working = effect.value
            }
        }

        if (tr.docChanged) {
            if (suggestion) {
                // An edit inside the range being replaced makes the suggestion stale. Edits elsewhere (a
                // collaborator typing further down the block) just move it.
                if (tr.changes.touchesRange(suggestion.from, suggestion.to)) {
                    suggestion = null
                } else {
                    const map = (pos: number, assoc: -1 | 1) => tr.changes.mapPos(pos, assoc)
                    suggestion = {
                        ...suggestion,
                        from: map(suggestion.from, -1),
                        to: map(suggestion.to, 1),
                        at: suggestion.at === undefined ? undefined : map(suggestion.at, 1),
                        scope: suggestion.scope && { from: map(suggestion.scope.from, -1), to: map(suggestion.scope.to, 1) },
                    }
                }
            }
            if (working !== null) working = tr.changes.mapPos(working, 1)
        }

        if (suggestion && tr.selection) {
            const head = tr.newSelection.main.head
            const scope = suggestion.scope ?? suggestion
            if (head < scope.from || head > scope.to) suggestion = null
        }

        if (suggestion === value.suggestion && working === value.working) return value
        return { suggestion, working }
    },
    provide: (field) =>
        EditorView.decorations.from(field, (state): DecorationSet => {
            if (state.suggestion) {
                // The click handler is attached by the extension (see ghostTheme/ghostExtension) so this file holds no app logic.
                const look = state.suggestion.look ?? null
                const text = look ? previewOf(state.suggestion.label, 140) : `→ ${previewOf(state.suggestion.label)}`
                return Decoration.set([
                    Decoration.widget({
                        widget: new GhostWidget(text, "Tab", acceptGhost, "suggestion", look),
                        side: 1,
                    }).range(state.suggestion.at ?? state.suggestion.to),
                ])
            }
            if (state.working !== null) {
                return Decoration.set([
                    Decoration.widget({ widget: new GhostWidget("Working…", "", null, "working"), side: 1 }).range(state.working),
                ])
            }
            return Decoration.none
        }),
})

const ghostTheme = EditorView.baseTheme({
    ".cm-sidekick-ghost": {
        color: "var(--ink-faint)",
        marginLeft: "0.5em",
        fontSize: "0.85em",
        fontStyle: "italic",
        whiteSpace: "pre-wrap",
        userSelect: "none",
    },
    ".cm-sidekick-suggestion": { cursor: "pointer" },
    ".cm-sidekick-working": { opacity: "0.7" },
    ".cm-sidekick-ghost kbd": {
        marginLeft: "0.5em",
        padding: "0 0.35em",
        fontFamily: "var(--font-sans, sans-serif)",
        fontStyle: "normal",
        fontSize: "0.8em",
        color: "var(--ink-soft)",
        background: "var(--sheet)",
        border: "1px solid var(--hairline)",
        borderRadius: "0.3em",
    },
    ".cm-sidekick-suggestion:hover": { color: "var(--ink-soft)" },
    // "Suggested repair" / "Suggested next step": a small tinted chip names what the ghost is.
    ".cm-sidekick-chip": {
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        padding: "1px 9px",
        borderRadius: "999px",
        background: "var(--tint)",
        color: "var(--primary)",
        fontFamily: "var(--font-sans, sans-serif)",
        fontStyle: "normal",
        fontSize: "12px",
        fontWeight: "500",
        lineHeight: "1.5",
        whiteSpace: "nowrap",
    },
    ".cm-sidekick-chip svg": { width: "12px", height: "12px", flexShrink: "0" },
    ".cm-sidekick-look-repair, .cm-sidekick-look-next": {
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "6px 10px",
        width: "fit-content",
        maxWidth: "100%",
        margin: "6px 0 2px",
        fontStyle: "normal",
        fontSize: "0.9em",
    },
    // The repair stays in the sentence, next to the equation it would replace.
    ".cm-sidekick-look-repair": { display: "inline-flex", margin: "0 0 0 0.6em", verticalAlign: "middle" },
    ".cm-sidekick-look-repair kbd, .cm-sidekick-look-next kbd": { marginLeft: "0" },
    ".cm-sidekick-look-repair code": {
        fontFamily: "var(--font-mono, monospace)",
        fontSize: "12.5px",
        color: "var(--ink)",
        background: "var(--muted)",
        padding: "1px 6px",
        borderRadius: "4px",
    },
    ".cm-sidekick-render": { color: "var(--ink)" },
    // The next step sits on a line of its own, faded, in a dashed outline. It isn't an equation yet, so no number.
    ".cm-sidekick-look-next": {
        padding: "4px 10px",
        border: "1px dashed color-mix(in srgb, var(--primary) 32%, transparent)",
        borderRadius: "6px",
        transition: "border-color 0.15s var(--ease)",
    },
    ".cm-sidekick-look-next:hover": { borderColor: "color-mix(in srgb, var(--primary) 55%, transparent)" },
    ".cm-sidekick-look-next .cm-sidekick-line": { color: "var(--ink)", opacity: "0.5" },
})

export const getGhost = (state: EditorState): GhostSuggestion | null => state.field(ghostField, false)?.suggestion ?? null

export function showGhost(view: EditorView, suggestion: GhostSuggestion) {
    view.dispatch({ effects: setSuggestion.of(suggestion) })
}

export function clearGhost(view: EditorView): boolean {
    const hadOne = getGhost(view.state) !== null || (view.state.field(ghostField, false)?.working ?? null) !== null
    if (hadOne) view.dispatch({ effects: [setSuggestion.of(null), setWorking.of(null)] })
    return hadOne
}

export function showWorking(view: EditorView, at: number) {
    view.dispatch({ effects: setWorking.of(Math.min(at, view.state.doc.length)) })
}

/** Replaces the suggestion's range with its text. Returns false (and does nothing) if there is none or the block is read-only. */
export function acceptGhost(view: EditorView): boolean {
    const suggestion = getGhost(view.state)
    if (!suggestion || view.state.readOnly) return false
    const end = suggestion.from + suggestion.insert.length
    view.dispatch({
        changes: { from: suggestion.from, to: suggestion.to, insert: suggestion.insert },
        selection: { anchor: end },
        effects: setSuggestion.of(null),
        userEvent: "input.sidekick",
    })
    return true
}

// "@sidekick ..." lines get a quiet reminder of how to run them. It is a decoration only, and it goes while a suggestion or "Working…" is showing.
const mentionHintField = StateField.define<DecorationSet>({
    create: (state) => hintFor(state),
    update: (value, tr) => (tr.docChanged || tr.selection || tr.effects.length ? hintFor(tr.state) : value),
    provide: (field) => EditorView.decorations.from(field),
})

function hintFor(state: EditorState): DecorationSet {
    const ghost = state.field(ghostField, false)
    if (!ghost || ghost.suggestion || ghost.working !== null || state.readOnly) return Decoration.none
    const head = state.selection.main.head
    const mention = mentionAt(state.doc.toString(), head)
    if (!mention || !mention.text) return Decoration.none
    const key = isMac() ? "⌘Enter" : "Ctrl+Enter"
    return Decoration.set([
        Decoration.widget({ widget: new GhostWidget("convert to LaTeX", key, null, "hint"), side: 1 }).range(mention.to),
    ])
}

// A flagged step ("check my work"): a quiet highlight on text that may be wrong. Like the ghost it is only a decoration,
// so it changes nothing in the document and moves nothing; it goes when the writer edits that text, or on Esc.
export type Flag = { from: number; to: number }
export const setFlag = StateEffect.define<Flag | null>()

export const flagField = StateField.define<Flag | null>({
    create: () => null,
    update(value, tr) {
        for (const effect of tr.effects) if (effect.is(setFlag)) value = effect.value
        if (value && tr.docChanged) {
            if (tr.changes.touchesRange(value.from, value.to)) return null
            return { from: tr.changes.mapPos(value.from, -1), to: tr.changes.mapPos(value.to, 1) }
        }
        return value
    },
    provide: (field) =>
        EditorView.decorations.from(field, (flag): DecorationSet =>
            flag && flag.to > flag.from
                ? Decoration.set([Decoration.mark({ class: "cm-sidekick-flag" }).range(flag.from, flag.to)])
                : Decoration.none
        ),
})

const flagTheme = EditorView.baseTheme({
    ".cm-sidekick-flag": {
        textDecorationLine: "underline",
        textDecorationStyle: "wavy",
        textDecorationColor: "var(--pencil)",
        textDecorationThickness: "1px",
        textUnderlineOffset: "0.25em",
        backgroundColor: "var(--pencil-wash)",
        borderRadius: "0.2em",
    },
})

export const getFlag = (state: EditorState): Flag | null => state.field(flagField, false) ?? null

export function flagRange(view: EditorView, from: number, to: number) {
    view.dispatch({ effects: setFlag.of({ from, to }) })
}

export function clearFlag(view: EditorView): boolean {
    if (!getFlag(view.state)) return false
    view.dispatch({ effects: setFlag.of(null) })
    return true
}

/** Dismisses whatever the sidekick is showing in this block: a suggestion, the "Working…" hint, or a flagged step. */
export function clearTransient(view: EditorView): boolean {
    const ghostGone = clearGhost(view)
    const flagGone = clearFlag(view)
    return ghostGone || flagGone
}

export const ghostExtension: Extension = [ghostField, flagField, mentionHintField, ghostTheme, flagTheme]
