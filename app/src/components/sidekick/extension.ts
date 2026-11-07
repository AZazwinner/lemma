import { EditorView, keymap, ViewPlugin } from "@codemirror/view"
import { Prec, type Extension } from "@codemirror/state"
import { mentionAt } from "@/lib/sidekick-text"
import { closeSidekickUi, forgetView, runMention, setActiveView } from "@/lib/sidekick"
import { acceptGhost, clearGhost, getGhost, ghostExtension } from "./ghost"

// Everything the sidekick adds to a block's editor. It is one extension, so the editor only needs a single line.
//
// Keys: Tab accepts a suggestion and Esc dismisses it; both do nothing (and fall through to the editor's own
// handling) when there is no suggestion. Ctrl/Cmd+Enter runs an "@sidekick ..." line.
//
// This must come BEFORE the editor's own highest-precedence keymap in the extensions array, because the editor's Tab
// and Escape handlers always claim the key.
const sidekickKeys = Prec.highest(
    keymap.of([
        {
            key: "Tab",
            run: (view) => (getGhost(view.state) ? acceptGhost(view) : false),
        },
        {
            key: "Escape",
            run: (view) => {
                if (clearGhost(view)) return true
                return closeSidekickUi()
            },
        },
        {
            key: "Mod-Enter",
            run: (view) => {
                if (view.state.readOnly) return false
                const mention = mentionAt(view.state.doc.toString(), view.state.selection.main.head)
                if (!mention) return false
                return runMention(view)
            },
        },
    ])
)

// Tells the sidekick which block the writer is in, so the toolbar button acts on it (and, in collaborator mode, knows
// which block to write after).
function trackFocus(blockId: string) {
    return ViewPlugin.fromClass(
        class {
            constructor(readonly view: EditorView) {
                if (view.hasFocus) setActiveView(view, blockId)
            }
            destroy() {
                forgetView(this.view)
            }
        },
        {
            eventHandlers: {
                focus(_event, view) {
                    setActiveView(view, blockId)
                },
            },
        }
    )
}

export function sidekickExtension(blockId: string): Extension {
    return [sidekickKeys, ghostExtension, trackFocus(blockId)]
}
