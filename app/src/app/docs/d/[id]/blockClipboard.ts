
const BLOCK_MARKER_ATTR = "data-lemma-block"

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
}

export function buildBlockClipboardPayload(contents: string[]): { plain: string; html: string } {
    return {
        plain: contents.join("\n\n"),
        html: contents.map((c) => `<div ${BLOCK_MARKER_ATTR}="1">${escapeHtml(c)}</div>`).join(""),
    }
}

export async function writeBlocksToClipboard(contents: string[]): Promise<void> {
    const { plain, html } = buildBlockClipboardPayload(contents)
    try {
        await navigator.clipboard.write([
            new ClipboardItem({
                "text/plain": new Blob([plain], { type: "text/plain" }),
                "text/html": new Blob([html], { type: "text/html" }),
            }),
        ])
    } catch {

        await navigator.clipboard.writeText(plain).catch(() => {})
    }
}


export function extractBlocksFromClipboardEvent(event: ClipboardEvent): string[] | null {
    const html = event.clipboardData?.getData("text/html")
    if (!html) return null

    const parsed = new DOMParser().parseFromString(html, "text/html")
    const nodes = parsed.querySelectorAll(`[${BLOCK_MARKER_ATTR}]`)
    if (nodes.length === 0) return null

    return Array.from(nodes).map((n) => n.textContent ?? "")
}
