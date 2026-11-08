// Taking the writer to a heading or an equation. This is the one place the Outline touches the page itself: what is in the
// outline comes from the document (lib/doc-outline.ts), and only here is the matching element looked for so it can be
// scrolled to and lit up.

export type OutlineTarget = {
    blockId: string
    kind: "heading" | "equation"
    /** Which heading, or which displayed equation, of the block (see Heading.ordinal and OutlineEquation.ordinal). */
    ordinal: number
}

/** How far below the top of the page the thing scrolled to is put, so it is not hard against the edge. */
const OFFSET_PX = 16

/**
 * Where "the section being read" is measured from, below the top of the page. Smaller than a heading block is tall, so after
 * going to a heading the block under it has not yet reached this line and the heading is still the current one.
 */
export const READING_LINE_PX = 40

const HEADINGS = "h1, h2, h3, h4, h5, h6"

export function blockElement(container: HTMLElement, blockId: string): HTMLElement | null {
    return container.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(blockId)}"]`)
}

/** The heading or equation on the page, or its block if the typeset text does not have it (a block being edited, say). */
export function locate(container: HTMLElement, target: OutlineTarget): HTMLElement | null {
    const block = blockElement(container, target.blockId)
    if (!block) return null
    const inside = block.querySelectorAll<HTMLElement>(target.kind === "heading" ? HEADINGS : ".katex-display")
    return inside[target.ordinal] ?? block
}

export function prefersReducedMotion(): boolean {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/** Scrolls the page so the element is near the top. Returns false, and does nothing, if it is already there (or cannot go further). */
export function scrollToElement(container: HTMLElement, element: HTMLElement): boolean {
    const wanted = element.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - OFFSET_PX
    const top = Math.min(Math.max(0, wanted), container.scrollHeight - container.clientHeight)
    if (Math.abs(top - container.scrollTop) < 1) return false
    container.scrollTo({ top, behavior: prefersReducedMotion() ? "auto" : "smooth" })
    return true
}

/** A brief sweep of highlight across the element (the app's existing mb-flash). Restarts if it is already running. */
export function flash(element: HTMLElement) {
    element.classList.remove("mb-flash")
    void element.offsetWidth // lets the browser see the class gone, so adding it again restarts the animation
    element.classList.add("mb-flash")
    const done = () => {
        element.classList.remove("mb-flash")
        element.removeEventListener("animationend", done)
    }
    element.addEventListener("animationend", done)
    window.setTimeout(done, 1200)
}

/** The block at the reading line: the last one whose top is at or above it. Null if the page has no blocks. */
export function blockAtReadingLine(container: HTMLElement): string | null {
    const blocks = container.querySelectorAll<HTMLElement>("[data-block-id]")
    if (blocks.length === 0) return null
    const line = container.getBoundingClientRect().top + READING_LINE_PX
    let low = 0
    let high = blocks.length - 1
    let found = 0
    while (low <= high) {
        const mid = (low + high) >> 1
        if (blocks[mid].getBoundingClientRect().top <= line) {
            found = mid
            low = mid + 1
        } else {
            high = mid - 1
        }
    }
    return blocks[found].dataset.blockId ?? null
}
