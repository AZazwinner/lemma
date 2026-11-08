import type { Metadata } from "next"
import ForgotPasswordPage from "./ForgotPasswordPage"

export const metadata: Metadata = {
  title: "Forgot password — Lemma",
  alternates: { canonical: "/forgot-password" },
}

export default function Page() {
  return <ForgotPasswordPage />
}
