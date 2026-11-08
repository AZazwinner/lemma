import { apiFetch } from "@/lib/api-fetch"

const API_URL = process.env.NEXT_PUBLIC_API_URL

export type CreateDocResponse = {
    doc_id: string
}

/** Starts a new, blank document. */
export async function createDoc(): Promise<CreateDocResponse> {
  const token = localStorage.getItem("token")

  const res = await apiFetch(`${API_URL}/docs/new`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({}),
  })

  if (!res.ok) {
    throw new Error("Network error")
  }

  return res.json()
}

export type SuccessResponse = {
  success: boolean
}

export async function deleteDoc(docId: number): Promise<SuccessResponse> {
  const token = localStorage.getItem("token")

  const res = await apiFetch(`${API_URL}/doc?doc_id=${docId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  if (!res.ok) {
    throw new Error("Network error")
  }

  return res.json()
}

export type TrashedDocument = {
  id: number
  title: string
  created_at: string
  updated_at: string
  deleted_at: string
}

export async function getTrash(): Promise<{ docs: TrashedDocument[] }> {
  const token = localStorage.getItem("token")

  const res = await apiFetch(`${API_URL}/trash`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  if (!res.ok) {
    throw new Error("Network error")
  }

  return res.json()
}

export async function restoreDoc(docId: number): Promise<SuccessResponse> {
  const token = localStorage.getItem("token")

  const res = await apiFetch(`${API_URL}/doc/restore`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ doc_id: docId }),
  })

  if (!res.ok) {
    throw new Error("Network error")
  }

  return res.json()
}

export type DocumentVersion = {
  id: number
  created_at: string
}

export async function getDocVersions(docId: number): Promise<{ versions: DocumentVersion[] }> {
  const token = localStorage.getItem("token")

  const res = await apiFetch(`${API_URL}/doc/versions?doc_id=${docId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  if (!res.ok) {
    throw new Error("Network error")
  }

  return res.json()
}

export async function restoreDocVersion(docId: number, versionId: number): Promise<SuccessResponse> {
  const token = localStorage.getItem("token")

  const res = await apiFetch(`${API_URL}/doc/versions/restore`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ doc_id: docId, version_id: versionId }),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.detail || "Network error")
  }

  return res.json()
}

export async function permanentlyDeleteDoc(docId: number): Promise<SuccessResponse> {
  const token = localStorage.getItem("token")

  const res = await apiFetch(`${API_URL}/doc/permanent?doc_id=${docId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  if (!res.ok) {
    throw new Error("Network error")
  }

  return res.json()
}

export async function renameDoc(docId: number, title: string): Promise<SuccessResponse> {
  const token = localStorage.getItem("token")

  const res = await apiFetch(`${API_URL}/update-doc`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ doc_id: docId, title }),
  })

  if (!res.ok) {
    throw new Error("Network error")
  }

  return res.json()
}

export type DuplicateDocResponse = {
  doc_id: number
}

export async function duplicateDoc(docId: number): Promise<DuplicateDocResponse> {
  const token = localStorage.getItem("token")

  const res = await apiFetch(`${API_URL}/docs/duplicate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ doc_id: docId }),
  })

  if (!res.ok) {
    throw new Error("Network error")
  }

  return res.json()
}


export type ShareableDoc = {
  id: number
  owner_id: number
  owner_username: string
  permission: "read" | "write" | "owner"
}

export type DocumentResponse = {
  id: number
  title: string
  text: string
}

export type DocumentBlock = {
  id: string
  doc_id: number
  position: number
  type: string
  content: string
  updated_at: string
}

export type DocumentResponsePermission = {
  id: number
  owner_id: number
  owner: unknown

  title: string
  text: string
  blocks: DocumentBlock[]

  created_at: string
  updated_at: string

  permission: "read" | "write" | "owner"
  owner_username: string
}