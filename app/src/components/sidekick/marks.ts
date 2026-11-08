import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view"
import { EditorState, type Extension, StateEffect, StateField } from "@codemirror/state"
import { mentionAt } from "@/lib/sidekick-text"

// What the sidekick draws inside a block's editor. Everything else it shows (explanations, suggestions) is a card under
// the block, outside the editor. Both things here are decorations only: they are not part of the shared text, move nothing,
// and go away on their own when the writer edits the text they mark.

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)

// ---- the reminder after an "@sidekick ..." line ----------------------------------------------------------------------

class HintWidget extends WidgetType {
    constructor(
        readonly text: string,
        readonly key: string
    ) {
        super()
    }

    eq(other: HintWidget) {
        return other.text === this.text && other.key === this.key
    }

    toDOM() {
        const wrap = document.createElement("span")
        wrap.className = "cm-sidekick-hint"
        wrap.setAttribute("aria-hidden", "true")
        wrap.setAttribute("data-sidekick-ghost", "hint")
        const label = document.createElement("span")
        label.textContent = this.text
        const kbd = document.createElement("kbd")
        kbd.textContent = this.key
        wrap.append(label, kbd)
        return wrap
    }

    ignoreEvent() {
        return true
    }
}

/** Tells the hint to stay out of the way while the block already shows an answer (or is waiting for one). */
export const setHintHidden = StateEffect.define<boolean>()

const hintHiddenField = StateField.define<boolean>({
    create: () => false,
    update(value, tr) {
        for (const effect of tr.effects) if (effect.is(setHintHidden)) value = effect.value
        return value
    },
})

function hintFor(state: EditorState): DecorationSet {
    if (state.readOnly || state.field(hintHiddenField, false)) return Decoration.none
    const mention = mentionAt(state.doc.toString(), state.selection.main.head)
    if (!mention || !mention.text) return Decoration.none
    const key = isMac() ? "⌘Enter" : "Ctrl+Enter"
    return Decoration.set([Decoration.widget({ widget: new HintWidget("write it", key), side: 1 }).range(mention.to)])
}

const mentionHintField = StateField.define<DecorationSet>({
    create: (state) => hintFor(state),
    update: (value, tr) => (tr.docChanged || tr.selection || tr.effects.length ? hintFor(tr.state) : value),
    provide: (field) => EditorView.decorations.from(field),
})

// ---- a flagged step ----------------------------------------------------------------------------------------------------

export type Flag = { from: number; to: number }
export const setFlag = StateEffect.define<Flag | null>()

export const flagField = StateField.define<Flag | null>({
    create: () => null,
    update(value, tr) {
        for (const effect of tr.effects) if (effect.is(setFlag)) value = effect.value
        if (value && tr.docChanged) {
            // Editing the flagged text makes the flag stale; edits elsewhere in the block just move it.
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

export const getFlag = (state: EditorState): Flag | null => state.field(flagField, false) ?? null

export function flagRange(view: EditorView, from: number, to: number) {
    view.dispatch({ effects: setFlag.of({ from, to }) })
}

export function clearFlag(view: EditorView): boolean {
    if (!getFlag(view.state)) return false
    view.dispatch({ effects: setFlag.of(null) })
    return true
}

// Theme tokens only (no new colours or fonts): the squiggle is the page's red pencil, and the hint is quiet muted text.
const marksTheme = EditorView.baseTheme({
    ".cm-sidekick-hint": {
        marginLeft: "0.5em",
        color: "var(--muted-foreground)",
        fontSize: "0.85em",
        fontStyle: "italic",
        userSelect: "none",
    },
    ".cm-sidekick-hint kbd": {
        marginLeft: "0.5em",
        padding: "0 0.35em",
        fontFamily: "var(--font-sans, sans-serif)",
        fontStyle: "normal",
        fontSize: "0.8em",
        border: "1px solid var(--border)",
        borderRadius: "0.3em",
    },
    ".cm-sidekick-flag": {
        textDecorationLine: "underline",
        textDecorationStyle: "wavy",
        textDecorationColor: "var(--destructive)",
        textDecorationThickness: "1px",
        textUnderlineOffset: "0.25em",
        backgroundColor: "color-mix(in oklab, var(--destructive) 10%, transparent)",
        borderRadius: "0.2em",
    },
})

export const marksExtension: Extension = [flagField, hintHiddenField, mentionHintField, marksTheme]
