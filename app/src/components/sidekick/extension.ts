import { EditorView, keymap, ViewPlugin, type ViewUpdate } from "@codemirror/view"
import { Prec, type Extension } from "@codemirror/state"
import type * as Y from "yjs"
import { runMention } from "@/lib/sidekick-actions"
import { mentionAt } from "@/lib/sidekick-text"
import {
    acceptPending,
    dismissTop,
    flagCleared,
    getState,
    hasPending,
    registerBlock,
    revalidateBlock,
    setActiveBlock,
    setMenuOpen,
    subscribe,
    unregisterBlock,
} from "@/lib/sidekick"
import { getFlag, marksExtension, setHintHidden } from "./marks"

// Everything the sidekick adds to a block's editor, as one extension so the editor needs a single line.
//
// Keys: Tab accepts the suggestion shown under this block and Esc dismisses what the sidekick shows there; both do
// nothing (and fall through to the editor's own handling) when there is nothing to accept or dismiss. Ctrl/Cmd+Enter runs
// an "@sidekick ..." line. Nothing here moves the focus or the caret.
//
// This must come BEFORE the editor's own highest-precedence keymap in the extensions array, because the editor's Tab
// and Escape handlers always claim the key.
function sidekickKeys(blockId: string): Extension {
    return Prec.highest(
        keymap.of([
            {
                key: "Tab",
                run: () => (hasPending(blockId) ? acceptPending(blockId) : false),
            },
            {
                key: "Escape",
                run: () => {
                    // One Esc closes the sidekick's menu if it is open, else the most recent thing it shows in this block.
                    if (getState().menuOpen) {
                        setMenuOpen(false)
                        return true
                    }
                    return dismissTop(blockId)
                },
            },
            {
                key: "Mod-Enter",
                run: (view) => {
                    if (view.state.readOnly) return false
                    if (!mentionAt(view.state.doc.toString(), view.state.selection.main.head)) return false
                    return runMention(blockId)
                },
            },
        ])
    )
}

// Links this editor to the sidekick: it can find the block's editor and text, knows which block the writer is in, hears
// when the text its answers were made for has changed, and when the squiggle on a flagged step has gone.
//
// The store's cleanups can dispatch to this editor (to remove a squiggle), which is not allowed while an update is still
// being applied, so they run right after it.
function linkToSidekick(blockId: string, text: Y.Text) {
    return ViewPlugin.fromClass(
        class {
            private unsubscribe: () => void
            private hintHidden = false

            constructor(readonly view: EditorView) {
                registerBlock(blockId, view, text)
                // The "write it" reminder after an "@sidekick ..." line steps aside while an answer is on its way or showing.
                this.unsubscribe = subscribe(() => {
                    const hidden = getState().blocks[blockId]?.suggestion !== undefined
                    if (hidden === this.hintHidden || !this.view.dom.isConnected) return
                    this.hintHidden = hidden
                    queueMicrotask(() => this.view.dom.isConnected && this.view.dispatch({ effects: setHintHidden.of(hidden) }))
                })
            }

            update(update: ViewUpdate) {
                if (update.docChanged) queueMicrotask(() => revalidateBlock(blockId))
                if (getFlag(update.startState) && !getFlag(update.state)) queueMicrotask(() => flagCleared(blockId))
            }

            destroy() {
                this.unsubscribe()
                unregisterBlock(blockId, this.view)
            }
        },
        {
            eventHandlers: {
                focus() {
                    setActiveBlock(blockId)
                },
            },
        }
    )
}

export function sidekickExtension(blockId: string, text: Y.Text): Extension {
    return [sidekickKeys(blockId), marksExtension, linkToSidekick(blockId, text)]
}
