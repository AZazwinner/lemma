import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view"
import { EditorState, type Extension, StateEffect, StateField } from "@codemirror/state"
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
}

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
        readonly kind: "suggestion" | "working" | "hint"
    ) {
        super()
    }

    eq(other: GhostWidget) {
        return other.text === this.text && other.hint === this.hint && other.kind === this.kind
    }

    toDOM(view: EditorView) {
        const wrap = document.createElement("span")
        wrap.className = `cm-sidekick-ghost cm-sidekick-${this.kind}`
        wrap.setAttribute("aria-hidden", "true")
        wrap.setAttribute("data-sidekick-ghost", this.kind)

        const label = document.createElement("span")
        label.textContent = this.text
        wrap.append(label)

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

export const ghostField = StateField.define<GhostState>({
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
                    suggestion = { ...suggestion, from: tr.changes.mapPos(suggestion.from, -1), to: tr.changes.mapPos(suggestion.to, 1) }
                }
            }
            if (working !== null) working = tr.changes.mapPos(working, 1)
        }

        if (suggestion && tr.selection) {
            const head = tr.newSelection.main.head
            if (head < suggestion.from || head > suggestion.to) suggestion = null
        }

        if (suggestion === value.suggestion && working === value.working) return value
        return { suggestion, working }
    },
    provide: (field) =>
        EditorView.decorations.from(field, (state): DecorationSet => {
            if (state.suggestion) {
                // The click handler is attached by the extension (see ghostTheme/ghostExtension) so this file holds no app logic.
                return Decoration.set([
                    Decoration.widget({
                        widget: new GhostWidget(`→ ${previewOf(state.suggestion.label)}`, "Tab", acceptGhost, "suggestion"),
                        side: 1,
                    }).range(state.suggestion.to),
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
        color: "var(--muted-foreground)",
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
        border: "1px solid var(--border)",
        borderRadius: "0.3em",
    },
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

export const ghostExtension: Extension = [ghostField, mentionHintField, ghostTheme]
