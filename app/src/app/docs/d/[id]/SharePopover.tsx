"use client"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Copy, Trash } from "lucide-react"
import { DrawnCheck } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { createOrUpdateShareDoc, deleteShareDoc, getShareDocs } from "@/api/share"
import { getUserByUsername, GetUserResponse } from "@/api/user"
import { ShareableDoc } from "@/api/docs"
import type { User } from "@/hooks/useAuth"
import { UserAvatar } from "@/components/UserAvatar"

interface SharedUser {
  user_id: number
  username: string
  permission: "read" | "write"
}


const PERMISSION_LABELS: Record<"read" | "write", string> = {
  read: "Can view",
  write: "Can edit",
}


export function ShareContent({
  doc,
  user
}: {
  doc: ShareableDoc,
  user: User
}) {
  const docId = doc.id;
  const isOwner = doc && user && doc.owner_id == user.id;
  const [copied, setCopied] = useState(false)
  const [usernameInput, setUsernameInput] = useState("")

  const [sharedUsers, setSharedUsers] = useState<SharedUser[]>([])
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const fetchShares = async () => {
      try {
        const shares = await getShareDocs(docId)
        setSharedUsers(shares)
      } catch {
        setError("Couldn't load who this is shared with.")
      }
    }

    fetchShares()
  }, [docId])

  const shareLink = `${process.env.NEXT_PUBLIC_APP_URL}/docs/d/${docId}`

  const handleCopy = async () => {
    await navigator.clipboard.writeText(shareLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleAddUser = async (username: string, shareType: string) => {
    if (!username.trim()) return
    setError(null)

    let userResponse: GetUserResponse
    try {
      userResponse = await getUserByUsername(username)
    } catch {
      setError("Couldn't reach the server. Try again.")
      return
    }
    const user = userResponse?.user
    if (!user) {
      setError(`No user found with username "${username}".`)
      return
    }

    setSharedUsers((prev) => {
      const exists = prev.some(u => u.username === username)
      if (exists) return prev
      return [
        ...prev,
        { user_id: user.id, username: username.trim(), permission: "read" },
      ]
    })

    try {
      await createOrUpdateShareDoc({ doc_id: docId as unknown as number, user_id: user.id, share_type: shareType })
    } catch {
      setError("Couldn't share this document. Try again.")
    }
  }




  const handleChangePermission = async (userId: number, username: string, shareType: "read" | "write") => {
    setError(null)
    const previous = sharedUsers
    setSharedUsers((prev) =>
      prev.map(u => (u.user_id === userId ? { ...u, permission: shareType } : u))
    )

    try {
      await createOrUpdateShareDoc({ doc_id: docId as unknown as number, user_id: userId, share_type: shareType })
    } catch {
      setSharedUsers(previous)
      setError(`Couldn't update ${username}'s permission. Try again.`)
    }
  }

  return (
    <>
      <PopoverHeader>
        <PopoverTitle>Share document</PopoverTitle>
        <PopoverDescription>
          {
            doc.permission === "read"
              ? "See who has access to this document."
              : "Invite people by username and share via link."
          }
        </PopoverDescription>
      </PopoverHeader>

      {error && <div className="mb-swap text-xs text-destructive">{error}</div>}


      {doc.permission !== "read" && <div className="flex items-center gap-2">
        <Input
          placeholder="Enter username"
          value={usernameInput}
          onChange={(e) => setUsernameInput(e.target.value)}
        />
        <Button
          size="sm"
          onClick={() => {
            handleAddUser(usernameInput, "read");
            setUsernameInput("");
          }}
        >
          Add
        </Button>
      </div>}


      <div className="space-y-2 px-4">
        <div
          className="flex items-center justify-between gap-2 rounded-lg border border-hairline px-2 py-1 transition-colors hover:bg-tint"
        >
          <div className="flex items-center gap-2 min-w-0">
            <UserAvatar userId={doc.owner_id} name={doc.owner_username} />
            <span className="text-sm truncate">{doc.owner_username}</span>
          </div>

          <div className="flex items-center gap-2">
            <Select
              value={"owner"}
              disabled
            >
              <SelectTrigger className="w-[90px] h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent
                position="popper"
                sideOffset={4}
                avoidCollisions={false}
                className="min-w-[90px] w-[90px]">
                <SelectItem value="owner" className="pl-4">Owner</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="space-y-2 px-4">
        {isOwner && sharedUsers.length === 0 ? (
          <div className="text-xs text-muted-foreground">
            No users added yet.
          </div>
        ) : (

          sharedUsers.map((user, index) => (
            <div
              key={index}
              className="flex items-center justify-between gap-2 rounded-lg border border-hairline px-2 py-1 transition-colors hover:bg-tint"
            >
              <div className="flex items-center gap-2 min-w-0">
                <UserAvatar userId={user.user_id} name={user.username} />
                <span className="text-sm truncate">{user.username}</span>
              </div>

              <div className="flex items-center gap-2">
                <Select
                  value={user.permission}
                  disabled={doc.permission === "read"}
                  onValueChange={(value: string) => handleChangePermission(user.user_id, user.username, value as "read" | "write")}
                >
                  <SelectTrigger className="w-[90px] h-8">
                    <SelectValue>{PERMISSION_LABELS[user.permission]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent
                    position="popper"
                    sideOffset={4}
                    avoidCollisions={false}
                    className="min-w-[110px] w-[110px]">
                    <SelectItem value="read" className="pl-4">Can view</SelectItem>
                    <SelectItem value="write" className="pl-4">Can edit</SelectItem>
                  </SelectContent>
                </Select>

                {doc.permission !== "read" && <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Remove ${user.username}'s access`}
                  data-anim="tilt"
                  className="text-ink-faint hover:bg-destructive/10 hover:text-destructive"
                  onClick={async () => {
                    setError(null)
                    const previous = sharedUsers
                    setSharedUsers((prev) => prev.filter((_, i) => i !== index))
                    try {
                      await deleteShareDoc({ doc_id: docId as unknown as number, user_id: user.user_id })
                    } catch {
                      setSharedUsers(previous)
                      setError(`Couldn't remove ${user.username}'s access. Try again.`)
                    }
                  }}
                >
                  <Trash className="w-4 h-4" />
                </Button>}
              </div>
            </div>
          ))
        )}
      </div>


      <div className="flex items-center gap-2">
        <Input value={shareLink} readOnly key={copied ? "copied" : "idle"} className={cn("font-mono text-xs text-ink-soft", copied && "mb-flash")} />
        <Button onClick={handleCopy} size="sm" variant={copied ? "outline" : "default"} className={cn(copied && "text-ok")}>
          {copied ? <DrawnCheck className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          <span key={copied ? "copied" : "copy"} className="mb-swap">{copied ? "Copied" : "Copy"}</span>
        </Button>
      </div>
    </>
  )
}


export function SharePopover({
  doc,
  user
}: {
  doc: ShareableDoc,
  user: User
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline">Share</Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-2">
        <ShareContent doc={doc} user={user} />
      </PopoverContent>
    </Popover>
  )
}
