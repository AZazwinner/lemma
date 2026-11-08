


const FENCE = /(```[\s\S]*?```)/g
const INLINE_CODE = /(`[^`\n]*`)/g

function convertSegment(segment: string): string {
    return segment
        .replace(
            /\\\[([\s\S]+?)\\\]/g,

            (_match, inner: string) => `\n\n$$\n${inner.trim()}\n$$\n\n`
        )
        .replace(/\\\((.+?)\\\)/g, (_match, inner: string) => `$${inner}$`)
}

/** Applies `transform` to the text outside fenced code and `inline code`, and leaves the code exactly as it is. */
export function mapOutsideCode(source: string, transform: (segment: string) => string): string {
    return source
        .split(FENCE)
        .map((part, i) => {

            if (i % 2 === 1) return part
            return part
                .split(INLINE_CODE)
                .map((sub, j) => (j % 2 === 1 ? sub : transform(sub)))
                .join("")
        })
        .join("")
}

export function convertLatexBracketDelimiters(source: string): string {
    return mapOutsideCode(source, convertSegment)
}
