"use client"

import { Check, Copy } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"

/** A button that copies a shell command. If the browser refuses, the command is selected so you can copy it by hand. */
export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  async function copy(event: React.MouseEvent<HTMLButtonElement>) {
    try {
      await navigator.clipboard.writeText(command)
    } catch {
      const code = event.currentTarget.querySelector("code")
      if (code) getSelection()?.selectAllChildren(code)
      return
    }
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1600)
  }

  return (
    <Button
      size="lg"
      className="h-11 rounded-full px-5 active:scale-[0.97]"
      aria-label={`Copy ${command}`}
      onClick={copy}
    >
      <code className="font-mono text-[0.95rem]">{command}</code>
      {copied ? (
        <Check data-icon="inline-end" aria-hidden />
      ) : (
        <Copy data-icon="inline-end" aria-hidden />
      )}
      <span role="status" className="sr-only">
        {copied ? "Copied" : ""}
      </span>
    </Button>
  )
}
