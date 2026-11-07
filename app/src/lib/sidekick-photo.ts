import { imageToLatex, SidekickApiError } from "@/api/sidekick"
import { clearTransient, showGhost, showWorking } from "@/components/sidekick/ghost"
import { checkImageFile, ImageProblem, imageProblemText, prepareImage } from "@/lib/sidekick-image"
import { wrapLatex, previewOf } from "@/lib/sidekick-text"
import { getState, notify, notifyError, patchState, refreshUsage } from "@/lib/sidekick"

/**
 * Photo or screenshot of maths to LaTeX, shown as ghost text at the end of the block to accept with Tab. Starts only from
 * choosing a file; the picture is shrunk in the browser and is not kept anywhere.
 */
export async function photoToLatex(file: File): Promise<void> {
    if (getState().working) return
    const view = getState().view
    if (!view || !view.dom.isConnected) return notify({ kind: "error", text: "Click into the block where it should go first." })
    if (view.state.readOnly) return notify({ kind: "error", text: "This document is view-only." })

    const problem = checkImageFile(file)
    if (problem !== "ok") return notify({ kind: "error", text: imageProblemText(problem) })

    patchState({ working: "image", menuOpen: false })
    // The file dialog took the focus. Give it back to the block the writer was in, so the suggestion can be seen. This
    // runs only because they just chose a file; it moves no caret.
    view.focus()
    const sent = view.state.doc.toString()
    const replaceAll = sent.trim() === ""
    showWorking(view, sent.length)
    try {
        const prepared = await prepareImage(file)
        const result = await imageToLatex(prepared.base64, prepared.mime)
        if (!view.dom.isConnected || view.state.doc.toString() !== sent) {
            // The block changed while the sidekick was reading. Don't second-guess the writer.
            clearTransient(view)
            return
        }
        const block = wrapLatex(result.latex, true)
        showGhost(view, {
            from: replaceAll ? 0 : sent.length,
            to: sent.length,
            insert: replaceAll ? block : `\n${block}`,
            label: previewOf(result.latex.split("\n").join("  ")),
            scope: { from: 0, to: sent.length },
        })
    } catch (error) {
        if (view.dom.isConnected) clearTransient(view)
        if (error instanceof ImageProblem) notify({ kind: "error", text: imageProblemText(error.problem) })
        else if (error instanceof SidekickApiError && error.kind === "invalid") notify({ kind: "error", text: imageProblemText("unreadable") })
        else notifyError(error)
    } finally {
        patchState({ working: null })
        void refreshUsage()
    }
}
