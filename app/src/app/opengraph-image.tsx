import { ImageResponse } from "next/og"


export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

const INK = "#14181a"
const PAPER = "#f6f7f5"
const CHALK = "#1e4b3b"
const MUTED = "#5b625d"

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: PAPER,
          fontFamily: "system-ui, sans-serif",
        }}
      >

        <div style={{ display: "flex", position: "relative", width: 170, height: 170, marginBottom: 28 }}>
          <div
            style={{
              display: "flex",
              position: "absolute",
              right: 0,
              top: 6,
              width: 116,
              height: 138,
              border: `11px solid ${INK}`,
              borderRadius: 16,
            }}
          />
          <div
            style={{
              display: "flex",
              position: "absolute",
              left: 8,
              top: 96,
              width: 16,
              height: 48,
              background: CHALK,
              borderRadius: 8,
              transform: "rotate(-32deg)",
            }}
          />
          <div
            style={{
              display: "flex",
              position: "absolute",
              left: 30,
              top: 8,
              width: 16,
              height: 104,
              background: CHALK,
              borderRadius: 8,
              transform: "rotate(31deg)",
            }}
          />
        </div>

        <div style={{ display: "flex", fontSize: 76, fontWeight: 700, color: INK, letterSpacing: -2 }}>
          Lemma
        </div>
        <div style={{ display: "flex", fontSize: 32, color: MUTED, marginTop: 18 }}>
          Write math like it&apos;s a document
        </div>
      </div>
    ),
    { ...size }
  )
}
