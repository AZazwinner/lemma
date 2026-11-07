import { useEffect, useLayoutEffect, useRef, useState } from "react"
import * as Y from "yjs"
import type { Awareness } from "y-protocols/awareness.js"
import { EditorView, keymap } from "@codemirror/view"
import { EditorState, Prec } from "@codemirror/state"
import { defaultKeymap } from "@codemirror/commands"
import { snippet, nextSnippetField, prevSnippetField } from "@codemirror/autocomplete"
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next"
import LatexRenderer from "@/components/LatexRenderer"
import { insertImageMarkdown, insertTab, isInsideCodeFence, isInsideMathBlock, looksLikeLatex, MAX_IMAGE_BYTES, mathContextAt, readImageAsDataUri } from "./format-commands"
import type { FocusRequest } from "./TextEditor"
import { cn } from "@/lib/utils"
import { SlashMenu, filterSlashCommands } from "./SlashMenu"
import type { SlashCommand } from "./slash-commands"
import { MathSymbolMenu, filterMathSymbols } from "./MathSymbolMenu"
import type { MathSymbol } from "./math-symbols"
import { extractBlocksFromClipboardEvent } from "./blockClipboard"
import { imageDecorations } from "./imageWidget"
import { sidekickExtension } from "@/components/sidekick/extension"

type SlashMenuState = { query: string; left: number; top: number; index: number }
type SymbolMenuState = { query: string; from: number; to: number; left: number; top: number; index: number }

export function BlockEditor({
    id,
    type,
    text,
    position,
    awareness,
    undoManager,
    permission,
    insertBlock,
    deleteBlock,
    mergeBlockIntoPrevious,
    focusRequest,
    clearFocusRequest,
    requestFocus,
    containerRef,
    emptyDoc,
    onFocusView,
    onActiveViewUpdate,
    isSelected,
    onBlockMouseDown,
    consumeClickSuppression,
}: {
    id: string
    type: string
    text: Y.Text
    position: number
    awareness: Awareness
    undoManager: Y.UndoManager
    permission: "owner" | "read" | "write"
    insertBlock: (position: number, id: string, type: string, content?: string) => void
    deleteBlock: (position: number) => void
    mergeBlockIntoPrevious: (position: number) => number | null
    focusRequest: FocusRequest | null
    clearFocusRequest: () => void
    requestFocus: (index: number, atEnd?: boolean, pos?: number) => void
    containerRef: React.RefObject<HTMLDivElement | null>
    emptyDoc: boolean
    onFocusView?: (view: EditorView) => void
    onActiveViewUpdate?: () => void
    isSelected: boolean
    onBlockMouseDown: (index: number, e: React.MouseEvent) => void

    consumeClickSuppression: () => boolean
}) {
    const [isFocused, setIsFocused] = useState(false)
    const [previewText, setPreviewText] = useState(text.toString())
    const [slashMenu, setSlashMenu] = useState<SlashMenuState | null>(null)
    const [symbolMenu, setSymbolMenu] = useState<SymbolMenuState | null>(null)
    const editorContainerRef = useRef<HTMLDivElement | null>(null)
    const viewRef = useRef<EditorView | null>(null)


    useLayoutEffect(() => {
        if (isFocused) return
        editorContainerRef.current?.parentElement?.scrollIntoView({ block: "nearest" })
    }, [isFocused])


    const latest = useRef({ position, insertBlock, deleteBlock, mergeBlockIntoPrevious, requestFocus, onFocusView, onActiveViewUpdate, isFocused, slashMenu, symbolMenu })
    // A layout effect (not an assignment during render) so the ref is current before any other effect or event handler reads it.
    useLayoutEffect(() => {
        latest.current = { position, insertBlock, deleteBlock, mergeBlockIntoPrevious, requestFocus, onFocusView, onActiveViewUpdate, isFocused, slashMenu, symbolMenu }
    })


    const applySlashCommand = (view: EditorView, cmd: SlashCommand) => {
        view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: cmd.template },
            selection: { anchor: cmd.cursorOffset, head: cmd.cursorOffset },
        })
        setSlashMenu(null)
        view.focus()
    }


    const applyMathSymbol = (view: EditorView, sym: MathSymbol, from: number, to: number) => {
        const body = sym.template ?? sym.latex
        const context = mathContextAt(view.state.doc.toString(), from)
        const template = context === "text" ? `$${body}$\${0}` : `${body}\${0}`
        snippet(template)(view, null, from, to)
        setSymbolMenu(null)
        view.focus()
    }


    useEffect(() => {
        const unobserve = () => text.unobserve(onTextChange)
        const onTextChange = () => {
            if (latest.current.isFocused) return
            setPreviewText(text.toString())
        }
        text.observe(onTextChange)
        return unobserve
    }, [text])


    useEffect(() => {
        if (!editorContainerRef.current) return

        const splitBlock = (view: EditorView): boolean => {
            if (view.state.readOnly) return false


            const { state } = view
            const pos = state.selection.main.head
            const docText = state.doc.toString()
            if (isInsideCodeFence(docText, pos) || isInsideMathBlock(docText, pos)) {
                view.dispatch(state.replaceSelection("\n"))
                return true
            }


            const after = state.doc.toString().slice(pos)
            if (after.length > 0) {
                text.delete(pos, after.length)
            }

            const { position, insertBlock, requestFocus } = latest.current
            insertBlock(position + 1, crypto.randomUUID(), "paragraph", after)
            requestFocus(position + 1)
            return true
        }


        const mergeIntoPrevious = (view: EditorView): boolean => {
            if (view.state.readOnly) return false
            const { position, mergeBlockIntoPrevious, requestFocus } = latest.current
            if (position === 0) return false
            const sel = view.state.selection.main
            if (!sel.empty || sel.head !== 0) return false
            const joinPos = mergeBlockIntoPrevious(position)
            if (joinPos === null) return false
            requestFocus(position - 1, false, joinPos)
            return true
        }


        const menuEnter = (view: EditorView): boolean => {
            const { slashMenu, symbolMenu } = latest.current
            if (slashMenu) {
                const items = filterSlashCommands(slashMenu.query)
                const chosen = items[slashMenu.index]
                if (chosen) applySlashCommand(view, chosen)
                else setSlashMenu(null)
                return true
            }
            if (symbolMenu) {
                const items = filterMathSymbols(symbolMenu.query)
                const chosen = items[symbolMenu.index]
                if (chosen) applyMathSymbol(view, chosen, symbolMenu.from, symbolMenu.to)
                else setSymbolMenu(null)
                return true
            }
            return splitBlock(view)
        }

        const menuMove = (delta: number) => (view: EditorView): boolean => {
            const { slashMenu, symbolMenu } = latest.current
            if (slashMenu) {
                const items = filterSlashCommands(slashMenu.query)
                if (items.length === 0) return true
                const next = (slashMenu.index + delta + items.length) % items.length
                setSlashMenu({ ...slashMenu, index: next })
                return true
            }
            if (symbolMenu) {
                const items = filterMathSymbols(symbolMenu.query)
                if (items.length === 0) return true
                const next = (symbolMenu.index + delta + items.length) % items.length
                setSymbolMenu({ ...symbolMenu, index: next })
                return true
            }
            return false
        }


        const menuEscape = (view: EditorView): boolean => {
            if (latest.current.slashMenu) {
                setSlashMenu(null)
                return true
            }
            if (latest.current.symbolMenu) {
                setSymbolMenu(null)
                return true
            }
            view.contentDOM.blur()
            return true
        }

        const blockKeymap = Prec.highest(
            keymap.of([
                { key: "Enter", run: menuEnter },
                { key: "Shift-Enter", run: () => false },
                { key: "Backspace", run: mergeIntoPrevious },

                { key: "Tab", run: (view) => nextSnippetField(view) || insertTab(view) },
                { key: "Shift-Tab", run: prevSnippetField },
                { key: "ArrowDown", run: menuMove(1) },
                { key: "ArrowUp", run: menuMove(-1) },
                { key: "Escape", run: menuEscape },
            ])
        )

        const ensureVisible = () => {
            const el = editorContainerRef.current
            const container = containerRef.current
            if (!el || !container) return

            const buffer = 120
            const elBottom = el.offsetTop + el.scrollHeight
            const containerBottom = container.scrollTop + container.clientHeight
            const distanceFromBottom = containerBottom - elBottom
            if (distanceFromBottom < buffer) {
                container.scrollTop += buffer - distanceFromBottom
            }
        }


        const syncMenus = (view: EditorView) => {
            const doc = view.state.doc
            const pos = view.state.selection.main.head


            const isWholeBlockSlash = pos === doc.length && doc.lines === 1 && doc.sliceString(0, 1) === "/"

            if (isWholeBlockSlash) {
                const query = doc.sliceString(1)
                const blockMatches = filterSlashCommands(query)
                if (query.length === 0 || blockMatches.length > 0) {
                    if (latest.current.symbolMenu) setSymbolMenu(null)

                    const coords = view.coordsAtPos(0)
                    if (!coords) return
                    setSlashMenu((prev) => ({
                        query,
                        left: coords.left,
                        top: coords.bottom + 4,
                        index: prev && prev.query !== query ? 0 : (prev?.index ?? 0),
                    }))
                    return
                }
            }
            if (latest.current.slashMenu) setSlashMenu(null)


            const WINDOW = 2000
            const windowStart = Math.max(0, pos - WINDOW)
            const before = doc.sliceString(windowStart, pos)


            if (isInsideCodeFence(before, before.length)) {
                if (latest.current.symbolMenu) setSymbolMenu(null)
                return
            }


            const triggerRe = windowStart === 0
                ? /(?:^|[^a-zA-Z0-9])\/([a-zA-Z]+)$/
                : /[^a-zA-Z0-9]\/([a-zA-Z]+)$/
            const match = before.match(triggerRe)
            if (!match) {
                if (latest.current.symbolMenu) setSymbolMenu(null)
                return
            }

            const query = match[1]
            const from = pos - query.length - 1
            const coords = view.coordsAtPos(from)
            if (!coords) return
            setSymbolMenu((prev) => ({
                query,
                from,
                to: pos,
                left: coords.left,
                top: coords.bottom + 4,
                index: prev && prev.query !== query ? 0 : (prev?.index ?? 0),
            }))
        }


        const handlePaste = (event: ClipboardEvent, view: EditorView): boolean => {
            if (view.state.readOnly) return false


            const imageFile = Array.from(event.clipboardData?.items ?? [])
                .map((item) => item.getAsFile())
                .find((file): file is File => !!file && file.type.startsWith("image/"))
            if (imageFile) {
                event.preventDefault()
                event.stopPropagation()

                if (imageFile.size > MAX_IMAGE_BYTES) {
                    window.alert(`Image is too large to embed (max ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))}MB).`)
                    return true
                }

                readImageAsDataUri(imageFile).then((dataUri) => {
                    insertImageMarkdown(view, dataUri)
                })
                return true
            }

            const contents = extractBlocksFromClipboardEvent(event)
            if (contents && contents.length > 1) {
                event.preventDefault()
                event.stopPropagation()

                const { state } = view
                const pos = state.selection.main.head
                const docText = state.doc.toString()
                const before = docText.slice(0, pos)
                const after = docText.slice(pos)
                const firstChunk = before + contents[0]

                view.dispatch({
                    changes: { from: 0, to: docText.length, insert: firstChunk },
                    selection: { anchor: firstChunk.length, head: firstChunk.length },
                })

                const { position, insertBlock, requestFocus } = latest.current
                for (let i = 1; i < contents.length - 1; i++) {
                    insertBlock(position + i, crypto.randomUUID(), "paragraph", contents[i])
                }
                const lastIndex = contents.length - 1
                insertBlock(position + lastIndex, crypto.randomUUID(), "paragraph", contents[lastIndex] + after)
                requestFocus(position + lastIndex, false, contents[lastIndex].length)
                return true
            }



            const pastedText = (event.clipboardData?.getData("text/plain") ?? "").replace(/\r\n?/g, "\n")
            if (looksLikeLatex(pastedText)) {
                const { state } = view
                const { from, to } = state.selection.main
                const docText = state.doc.toString()
                if (mathContextAt(docText, from) === "text" && !isInsideCodeFence(docText, from)) {
                    event.preventDefault()
                    event.stopPropagation()

                    const trimmed = pastedText.trim()
                    const wrapped = trimmed.includes("\n") ? `$$\n${trimmed}\n$$` : `$${trimmed}$`
                    view.dispatch({
                        changes: { from, to, insert: wrapped },
                        selection: { anchor: from + wrapped.length, head: from + wrapped.length },
                    })
                    return true
                }
            }

            return false
        }

        const state = EditorState.create({
            doc: text.toString(),
            extensions: [
                sidekickExtension(),
                blockKeymap,

                Prec.highest(keymap.of(yUndoManagerKeymap)),
                keymap.of(defaultKeymap),
                EditorView.lineWrapping,
                EditorState.readOnly.of(permission === "read"),
                imageDecorations,
                EditorView.domEventHandlers({ paste: handlePaste }),
                yCollab(text, awareness, { undoManager }),
                EditorView.updateListener.of((update) => {
                    if (update.docChanged) ensureVisible()
                    if (update.docChanged || update.selectionSet) {
                        syncMenus(update.view)

                        if (latest.current.isFocused) latest.current.onActiveViewUpdate?.()
                    }
                }),
                EditorView.theme({
                    "&": { fontSize: "1rem", fontFamily: "var(--font-serif, serif)" },
                    ".cm-content": { padding: "0.5rem 2.5rem", caretColor: "var(--foreground)" },
                    ".cm-line": { padding: 0, lineHeight: "1.625" },
                    "&.cm-focused": { outline: "none" },

                    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)" },
                }),
            ],
        })

        const view = new EditorView({ state, parent: editorContainerRef.current })
        viewRef.current = view

        view.contentDOM.addEventListener("focus", () => {
            setIsFocused(true)
            latest.current.onFocusView?.(view)
        })
        view.contentDOM.addEventListener("blur", () => {
            setIsFocused(false)

            setPreviewText(text.toString())
            setSlashMenu(null)
            setSymbolMenu(null)
        })

        return () => {
            view.destroy()
            viewRef.current = null
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [text])


    useEffect(() => {
        if (!focusRequest || focusRequest.index !== position) return
        const view = viewRef.current
        if (!view) return

        view.focus()
        const pos = focusRequest.pos ?? (focusRequest.atEnd ? view.state.doc.length : 0)
        view.dispatch({ selection: { anchor: pos, head: pos } })
        clearFocusRequest()
    }, [focusRequest, position, clearFocusRequest])

    useEffect(() => {
        if (emptyDoc && position === 0 && viewRef.current) {
            viewRef.current.focus()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    return (
        <div className="w-full flex justify-center">
            <div key={id} data-block-index={position} className="w-full max-w-4xl relative">
                <div
                    onClick={() => {
                        if (consumeClickSuppression()) return
                        viewRef.current?.focus()
                    }}
                    onMouseDown={(e) => onBlockMouseDown(position, e)}
                    className={cn(
                        "rounded-md px-10 py-2",
                        "text-base font-serif leading-relaxed whitespace-pre-wrap break-words",
                        "cursor-text transition-opacity duration-150",

                        isFocused
                            ? "absolute inset-0 z-0 pointer-events-none opacity-0"
                            : "relative z-10 opacity-100",
                        isSelected ? "bg-blue-100 dark:bg-blue-500/20" : "hover:bg-muted/60"
                    )}
                >
                    <LatexRenderer content={previewText} />
                </div>
                <div
                    ref={editorContainerRef}
                    className={cn(
                        "w-full rounded-md transition-opacity duration-150",
                        isFocused
                            ? "relative z-10 bg-muted/60 opacity-100"
                            : "absolute inset-0 z-0 pointer-events-none bg-transparent opacity-0"
                    )}
                />
            </div>

            {slashMenu && (
                <SlashMenu
                    left={slashMenu.left}
                    top={slashMenu.top}
                    items={filterSlashCommands(slashMenu.query)}
                    activeIndex={slashMenu.index}
                    onHover={(index) => setSlashMenu((prev) => (prev ? { ...prev, index } : prev))}
                    onSelect={(cmd) => {
                        if (viewRef.current) applySlashCommand(viewRef.current, cmd)
                    }}
                />
            )}

            {symbolMenu && (
                <MathSymbolMenu
                    left={symbolMenu.left}
                    top={symbolMenu.top}
                    items={filterMathSymbols(symbolMenu.query)}
                    activeIndex={symbolMenu.index}
                    onHover={(index) => setSymbolMenu((prev) => (prev ? { ...prev, index } : prev))}
                    onSelect={(sym) => {
                        if (viewRef.current) applyMathSymbol(viewRef.current, sym, symbolMenu.from, symbolMenu.to)
                    }}
                />
            )}
        </div>
    )
}
