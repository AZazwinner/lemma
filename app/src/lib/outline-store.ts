import type * as Y from "yjs"
import { deriveOutline, EMPTY_OUTLINE, sameOutline, type Outline } from "@/lib/doc-outline"

// Keeps the document's Outline up to date, and tells React when it changed.
//
//   - The blocks themselves arriving, leaving or moving is applied at once: a block pasted in or split off should have its
//     headings and equation numbers on the very next paint.
//   - Typing is applied after a short pause (and at least once a second while someone keeps typing), so a burst of keystrokes
//     costs one pass. Only the blocks that were typed in are read again.
//   - Whatever the pass finds, subscribers are told only if the outline is different. Typing inside a paragraph, yours or a
//     collaborator's, finds the same outline and notifies nobody.
//
// It reads the blocks' Y.Text only: the same data every collaborator has. Never the DOM, never a block's typeset preview.

export type TrackedBlock = { id: string; text: Y.Text }

export const OUTLINE_DEBOUNCE_MS = 200
export const OUTLINE_MAX_WAIT_MS = 1000

export class OutlineStore {
    private snapshot: Outline = EMPTY_OUTLINE
    private order: string[] = []
    private readonly watched = new Map<string, { text: Y.Text; onChange: () => void }>()
    private readonly sources = new Map<string, string>()
    private readonly dirty = new Set<string>()
    private readonly listeners = new Set<() => void>()
    private timer: ReturnType<typeof setTimeout> | null = null
    private firstDirtyAt = 0

    constructor(
        private readonly delay = OUTLINE_DEBOUNCE_MS,
        private readonly maxWait = OUTLINE_MAX_WAIT_MS
    ) {}

    /** For `useSyncExternalStore`. */
    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener)
        return () => {
            this.listeners.delete(listener)
        }
    }

    getSnapshot = (): Outline => this.snapshot

    /** The document's blocks, in order, as they are now. Call it whenever a block is added, removed or moved. */
    setBlocks(blocks: readonly TrackedBlock[]): void {
        const keep = new Map(blocks.map((b) => [b.id, b]))
        for (const [id, watch] of this.watched) {
            if (keep.get(id)?.text === watch.text) continue
            watch.text.unobserve(watch.onChange)
            this.watched.delete(id)
            this.sources.delete(id)
            this.dirty.delete(id)
        }
        for (const block of blocks) {
            if (this.watched.has(block.id)) continue
            const onChange = () => this.touched(block.id)
            block.text.observe(onChange)
            this.watched.set(block.id, { text: block.text, onChange })
            this.sources.set(block.id, block.text.toString())
        }
        this.order = blocks.map((b) => b.id)
        this.flush()
    }

    /** Stops listening. The store can be given blocks again afterwards. */
    detach(): void {
        if (this.timer) clearTimeout(this.timer)
        this.timer = null
        this.firstDirtyAt = 0
        for (const watch of this.watched.values()) watch.text.unobserve(watch.onChange)
        this.watched.clear()
        this.sources.clear()
        this.dirty.clear()
        this.order = []
    }

    private touched(id: string): void {
        this.dirty.add(id)
        const now = Date.now()
        if (!this.firstDirtyAt) this.firstDirtyAt = now
        if (this.timer) clearTimeout(this.timer)
        const wait = Math.min(this.delay, Math.max(0, this.maxWait - (now - this.firstDirtyAt)))
        this.timer = setTimeout(() => this.flush(), wait)
    }

    /** Reads the blocks typed in since the last pass, and publishes the outline if it is different. */
    flush(): void {
        if (this.timer) clearTimeout(this.timer)
        this.timer = null
        this.firstDirtyAt = 0
        for (const id of this.dirty) {
            const watch = this.watched.get(id)
            if (watch) this.sources.set(id, watch.text.toString())
        }
        this.dirty.clear()

        const next = deriveOutline(
            this.order.map((id) => ({ id, source: this.sources.get(id) ?? "" })),
            this.snapshot
        )
        if (sameOutline(this.snapshot, next)) return
        this.snapshot = next
        for (const listener of [...this.listeners]) listener()
    }
}
