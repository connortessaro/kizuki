import type { ReactNode } from "react"

/** Quoted material, in the same yellow the app uses. */
function Q({ children }: { children: ReactNode }) {
  return <span className="text-[#FFD60A]">“{children}”</span>
}

/** One line of the app's conversation: a mark in its own column, then the text. */
function Line({
  mark,
  markClass,
  className = "",
  gap = false,
  indent = false,
  children,
}: {
  mark?: string
  markClass?: string
  className?: string
  gap?: boolean
  indent?: boolean
  children: ReactNode
}) {
  return (
    <div
      className={`term-line flex ${gap ? "mt-4" : "mt-1"} ${indent ? "pl-4" : ""}`}
    >
      <span aria-hidden className={`w-5 shrink-0 ${markClass ?? ""}`}>
        {mark ?? ""}
      </span>
      <p className={className}>{children}</p>
    </div>
  )
}

/** The terminal app mid-session, drawn the way Kizuki draws it: marks, quote colors, the pick list, and the status line. */
export function Terminal() {
  return (
    <figure
      aria-label="A teach-back exchange in the Kizuki terminal app"
      className="mx-auto w-full max-w-3xl overflow-hidden rounded-xl bg-[#161618] text-left shadow-2xl ring-1 shadow-black/25 ring-black/10 dark:ring-white/10"
    >
      <div
        aria-hidden
        className="relative flex h-9 items-center gap-2 border-b border-white/5 bg-[#232326] px-3.5"
      >
        <span className="size-3 rounded-full bg-[#ff5f57]" />
        <span className="size-3 rounded-full bg-[#febc2e]" />
        <span className="size-3 rounded-full bg-[#28c840]" />
        <span className="absolute inset-0 grid place-items-center text-xs font-medium text-white/40">
          kizuki
        </span>
      </div>

      <div className="px-4 pt-4 pb-3 font-mono text-[12.5px] leading-relaxed text-[#e6e6e6] sm:px-5 sm:text-[13px]">
        <div className="term-line rounded-lg border border-[#0A84FF] px-3 py-2">
          <p>
            <span className="font-bold text-[#0A84FF]">気</span>{" "}
            <span className="font-bold">Kizuki</span>{" "}
            <span className="text-white/45">1.0.0</span>
          </p>
          <p className="text-white/45">
            Teach a concept back. Kizuki plays the student and quotes your
            material.
          </p>
        </div>

        <Line gap mark="›" markClass="text-white/40" className="text-white/50">
          /teach calvin cycle
        </Line>
        <Line gap mark="◆" markClass="text-[#0A84FF]" className="font-bold">
          Teach: The Calvin cycle
        </Line>
        <Line className="text-white/60">
          Explain it from memory, in your own words. The material stays hidden
          until you finish.
        </Line>
        <Line gap mark="›" markClass="text-white/40" className="text-white/50">
          The Calvin cycle happens in the{" "}
          <mark className="term-mark bg-transparent text-white/80">
            thylakoid membranes
          </mark>
          . It uses ATP and NADPH to turn carbon dioxide into sugar.
        </Line>
        <Line gap mark="◆" markClass="text-[#0A84FF]" className="font-bold">
          Round 1 of up to 3
        </Line>
        <Line gap mark="●" markClass="text-[#0A84FF]">
          The section “The Calvin cycle” of photosynthesis.md says:{" "}
          <Q>The Calvin cycle takes place in the stroma.</Q> You wrote:{" "}
          <Q>thylakoid membranes</Q>. How does that fit?
        </Line>
        <Line
          indent
          mark="⎿"
          markClass="text-white/40"
          className="text-[#64D2FF]"
        >
          [1] The section “The Calvin cycle” of photosynthesis.md
        </Line>

        <div
          aria-hidden
          className="term-line mt-4 rounded-lg border border-[#0A84FF] px-3 py-2"
        >
          <p className="font-bold">Which is right?</p>
          <p className="mt-2 font-bold text-[#0A84FF]">
            ❯ The material is right (I got it wrong)
          </p>
          <p>&nbsp; The material is wrong</p>
          <p>&nbsp; Kizuki misread what I wrote</p>
          <p className="mt-2 text-white/40">
            ↑↓ move · enter picks · esc stops
          </p>
        </div>
        <p className="term-line mt-2 px-3 text-white/40">
          kizuki · Biology · 3 due · qwen3.5:2b
        </p>
      </div>
    </figure>
  )
}
