import { Suspense } from "react"
import type { Metadata } from "next"
import ResetPasswordPage from "./ResetPasswordPage"


export const metadata: Metadata = {
  title: "Reset password — Lemma",
  robots: { index: false, follow: false },
}

export default function Page() {
  return (
    <Suspense fallback={<div />}>
      <ResetPasswordPage />
    </Suspense>
  )
}
