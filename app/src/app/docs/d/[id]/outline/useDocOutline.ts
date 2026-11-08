"use client"

import { useCallback, useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react"
import type { Outline } from "@/lib/doc-outline"
import { OutlineStore, type TrackedBlock } from "@/lib/outline-store"

/**
 * The document's outline: its headings, and the equations that show a number in the margin. The page margin and the Outline
 * panel both read this one value, so they cannot disagree.
 *
 * `blocks` is the list `useYDoc` returns, which changes when a block is added, removed or moved (not when one is typed in).
 * Typing is picked up from the blocks' own text, after a short pause, and re-renders the caller only if the outline is different.
 * `flushOutline` does not wait for the pause: call it when the cursor leaves a block, which is when that block is typeset again,
 * so its equations come out of the editor already numbered.
 */
export function useDocOutline(blocks: readonly TrackedBlock[]): { outline: Outline; flushOutline: () => void } {
    const [store] = useState(() => new OutlineStore())

    // A layout effect, so the outline already matches the blocks when the browser paints: a block pasted in never shows a frame
    // without its equation numbers.
    useLayoutEffect(() => {
        store.setBlocks(blocks)
    }, [store, blocks])

    useEffect(() => () => store.detach(), [store])

    const outline = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
    const flushOutline = useCallback(() => store.flush(), [store])
    return { outline, flushOutline }
}
