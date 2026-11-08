"use client"


export default function GlobalError({
    reset,
}: {
    error: Error & { digest?: string }
    reset: () => void
}) {
    return (
        <html lang="en">
            <body>
                <div style={{
                    display: "flex",
                    minHeight: "100vh",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "1.5rem",
                    padding: "1rem",
                    textAlign: "center",
                    fontFamily: "system-ui, sans-serif",
                }}>
                    <div>
                        <h1 style={{ fontSize: "1.5rem", fontWeight: 600 }}>Something went wrong</h1>
                        <p style={{ color: "#737373", maxWidth: "24rem" }}>
                            Lemma hit an unexpected error. Try reloading the page.
                        </p>
                    </div>
                    <button
                        onClick={() => reset()}
                        style={{
                            borderRadius: "0.5rem",
                            border: "1px solid #e5e5e5",
                            padding: "0.5rem 1rem",
                            fontSize: "0.875rem",
                            cursor: "pointer",
                        }}
                    >
                        Try again
                    </button>
                </div>
            </body>
        </html>
    )
}
