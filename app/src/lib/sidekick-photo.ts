import { imageToLatex, SidekickApiError } from "@/api/sidekick"
import { checkImageFile, ImageProblem, imageProblemText, prepareImage } from "@/lib/sidekick-image"
import { wrapLatex } from "@/lib/sidekick-text"
import {
    clearSlot,
    editorFor,
    getState,
    isCurrentSlot,
    makeAnchor,
    nextSlotId,
    noteForError,
    noteIn,
    refreshUsage,
    resolveAnchor,
    setSlot,
} from "@/lib/sidekick"

/**
 * Photo or screenshot of maths to LaTeX, shown as a suggestion under the block the writer was last in, to accept with Tab
 * or a click. Starts only from choosing a file; the picture is shrunk in the browser and is not kept anywhere.
 */
export async function photoToLatex(file: File): Promise<void> {
    const blockId = getState().activeBlockId
    const ref = blockId ? editorFor(blockId) : undefined
    if (!blockId || !ref || !ref.view.dom.isConnected) return
    if (ref.view.state.readOnly) return noteIn(blockId, "suggestion", { kind: "error", text: "This document is view-only." })

    const problem = checkImageFile(file)
    if (problem !== "ok") return noteIn(blockId, "suggestion", { kind: "error", text: imageProblemText(problem) })

    // The whole block as it is now: if it changes while the sidekick is reading, the answer is dropped.
    const sent = ref.text.toString()
    const anchor = makeAnchor(ref.text, 0, sent.length)
    const replaceAll = sent.trim() === ""

    const id = nextSlotId()
    setSlot(blockId, "suggestion", { id, phase: "loading", kind: "photo" })
    try {
        const prepared = await prepareImage(file)
        const result = await imageToLatex(prepared.base64, prepared.mime)
        if (!isCurrentSlot(blockId, "suggestion", id)) return
        if (!resolveAnchor(ref.text, anchor)) return clearSlot(blockId, "suggestion")

        const block = wrapLatex(result.latex, true)
        setSlot(blockId, "suggestion", {
            id,
            phase: "ready",
            kind: "photo",
            mock: result.mock,
            proposal: {
                label: "Suggested equation",
                edit: replaceAll ? { anchor, mode: "replace", insert: block } : { anchor, mode: "after", insert: `\n${block}` },
                blocksAfter: [],
                show: { snippet: block },
                why: "",
            },
        })
    } catch (error) {
        if (!isCurrentSlot(blockId, "suggestion", id)) return
        if (error instanceof ImageProblem) noteIn(blockId, "suggestion", { kind: "error", text: imageProblemText(error.problem) })
        else if (error instanceof SidekickApiError && error.kind === "invalid") noteIn(blockId, "suggestion", { kind: "error", text: imageProblemText("unreadable") })
        else noteForError(blockId, "suggestion", error)
    } finally {
        void refreshUsage()
    }
}
