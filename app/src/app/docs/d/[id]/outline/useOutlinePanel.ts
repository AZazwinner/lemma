"use client"

import { useCallback, useRef, useState, useSyncExternalStore, type RefObject } from "react"

// Whether the Outline panel is open. On a wide screen the panel sits beside the page and its state is remembered across
// visits. On a narrow screen (the same 640px the page's own stylesheet uses) it is a drawer over the page, and a drawer always
// starts closed: the answer you gave for a wide screen should not cover the document on a phone.

const STORAGE_KEY = "lemma:outline-open"
const NARROW = "(max-width: 640px)"

export type OutlinePanelState = {
    open: boolean
    setOpen: (open: boolean) => void
    /** Narrow screen: the panel is a drawer. */
    narrow: boolean
    /** The button that opens it. A drawer gives focus back to it when it closes. */
    triggerRef: RefObject<HTMLButtonElement | null>
}

function readStored(): boolean {
    try {
        return window.localStorage.getItem(STORAGE_KEY) === "1"
    } catch {
        return false // storage blocked or full: just start closed
    }
}

function writeStored(open: boolean) {
    try {
        window.localStorage.setItem(STORAGE_KEY, open ? "1" : "0")
    } catch {
        // not remembered this time
    }
}

function subscribeNarrow(onChange: () => void) {
    const query = window.matchMedia(NARROW)
    query.addEventListener("change", onChange)
    return () => query.removeEventListener("change", onChange)
}

export function useOutlinePanel(): OutlinePanelState {
    const narrow = useSyncExternalStore(
        subscribeNarrow,
        () => window.matchMedia(NARROW).matches,
        () => false
    )
    const [wideOpen, setWideOpen] = useState(() => typeof window !== "undefined" && readStored())
    const [drawerOpen, setDrawerOpen] = useState(false)
    const triggerRef = useRef<HTMLButtonElement | null>(null)

    const setOpen = useCallback(
        (open: boolean) => {
            if (narrow) {
                setDrawerOpen(open)
            } else {
                setWideOpen(open)
                writeStored(open)
            }
        },
        [narrow]
    )

    return { open: narrow ? drawerOpen : wideOpen, setOpen, narrow, triggerRef }
}
