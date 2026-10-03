"use client"

import { Check, Copy } from "lucide-react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"

/** A button that copies a shell command. If the browser refuses, the command is selected so you can copy it by hand. */
export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(timer)
  }, [copied])

  return (
    <Button
      size="lg"
      className="h-11 gap-3 rounded-full px-5 font-mono text-[0.95rem] active:scale-[0.97]"
      aria-label={`Copy ${command}`}
      onClick={async (event) => {
        try {
          await navigator.clipboard.writeText(command)
          setCopied(true)
        } catch {
          const code = event.currentTarget.querySelector("code")
          if (code) getSelection()?.selectAllChildren(code)
        }
      }}
    >
      <code>{command}</code>
      {copied ? <Check aria-hidden /> : <Copy aria-hidden className="opacity-60" />}
      <span role="status" className="sr-only">
        {copied ? "Copied" : ""}
      </span>
    </Button>
  )
}
