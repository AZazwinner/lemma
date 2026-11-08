// The red squiggle under a flagged step while its block is shown as typeset maths (not being edited). It uses the CSS
// Custom Highlight API, which draws over a range of text without changing the page's DOM, so it cannot disturb what React
// renders there. Where the browser lacks the API nothing is drawn; the one-line message under the block says the same thing.

const NAME = "sidekick-flag"
const ranges = new Map<string, Range>()

const supported = () => typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined"

// The look of the mark: the page's red pencil, wavy, with a faint wash. It is added to the page when first needed, and only
// where the browser has the API, rather than written in globals.css, because the CSS build does not know `::highlight()`.
let styled = false
function ensureStyle() {
    if (styled) return
    styled = true
    const style = document.createElement("style")
    style.textContent = `::highlight(${NAME}) { text-decoration: underline wavy var(--pencil) 1px; text-underline-offset: 0.25em; background-color: var(--pencil-wash); }`
    document.head.append(style)
}

/** Marks (or, with null, unmarks) a range of one block's rendered text. */
export function setBlockFlag(blockId: string, range: Range | null) {
    if (!supported()) return
    if (range) {
        ensureStyle()
        ranges.set(blockId, range)
    } else {
        ranges.delete(blockId)
    }
    if (ranges.size === 0) CSS.highlights.delete(NAME)
    else CSS.highlights.set(NAME, new Highlight(...ranges.values()))
}

const squash = (text: string) => text.replace(/\s+/g, "")

/**
 * The rendered text that corresponds to a flagged piece of source: the typeset equation whose LaTeX contains it (the whole
 * equation, since a line inside a display equation can't be picked out of it), else the plain text that matches.
 */
export function findRenderedRange(root: HTMLElement, source: string): Range | null {
    const wanted = squash(source)
    if (!wanted) return null

    for (const math of root.querySelectorAll<HTMLElement>(".katex")) {
        const tex = math.querySelector('annotation[encoding="application/x-tex"]')?.textContent ?? ""
        if (squash(tex).includes(wanted)) {
            const range = document.createRange()
            range.selectNodeContents(math.querySelector(".katex-html") ?? math)
            return range
        }
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => (node.parentElement?.closest(".katex-mathml") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    })
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent ?? ""
        const at = text.indexOf(source.trim())
        if (at !== -1) {
            const range = document.createRange()
            range.setStart(node, at)
            range.setEnd(node, at + source.trim().length)
            return range
        }
    }
    return null
}
