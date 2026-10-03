import { ArrowUpRight } from "lucide-react"
import Link from "next/link"
import type { ReactNode } from "react"

import { CopyCommand } from "@/components/copy-command"
import { Terminal } from "@/components/terminal"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const GITHUB = "https://github.com/connortessaro/kizuki"

/** The top bar's links. Narrow screens hide the first two. */
const NAV = [
  { href: "#research", label: "Research", hideBelow: "hidden md:inline-flex" },
  { href: "#how", label: "How it works", hideBelow: "hidden sm:inline-flex" },
  { href: "#commands", label: "Commands" },
  { href: "#setup", label: "Set up" },
]

const RESEARCH = [
  {
    figure: "50% more",
    text: "remembered a week later by students who practiced recalling a passage, compared with students who reread it: 61% against 40%.",
    source: "Roediger & Karpicke, 2006",
    href: "https://doi.org/10.1111/j.1467-9280.2006.01693.x",
  },
  {
    figure: "¼ the reading",
    text: "for the same students. The recall group read the passage 3.4 times; the rereading group read it 14.2 times and still remembered less.",
    source: "Roediger & Karpicke, 2006",
    href: "https://doi.org/10.1111/j.1467-9280.2006.01693.x",
  },
  {
    figure: "77%",
    text: "of students who crammed scored below the average student who spread the same recall practice over days.",
    source: "Latimier, Peyre & Ramus, 2021, a research review",
    href: "https://doi.org/10.1007/s10648-020-09572-8",
  },
  {
    figure: "71%",
    text: "of students who studied for a test scored below the average student who prepared to teach the material and then taught it.",
    source: "Kobayashi, 2019, a review of 28 studies",
    href: "https://doi.org/10.1111/jpr.12221",
  },
]

const MEASURED = [
  {
    figure: "92%",
    text: "of planted mistakes caught in Kizuki's model tests, with the default small model on a laptop.",
  },
  {
    figure: "0",
    text: "made-up quotes shown. Code checks every quote word for word against your material before you see it.",
  },
  {
    figure: "$0",
    text: "to run. No account, and your material stays on your computer.",
  },
]

const STEPS = [
  {
    title: "Add your material",
    text: "Slides, PDFs, Word and Excel files, notes. Drop them onto the terminal window. Kizuki reads the text and remembers the page, slide, or cell each passage came from.",
  },
  {
    title: "Confirm the concepts",
    text: (
      <>
        Kizuki turns each heading into a concept, and a small model suggests
        ideas inside each section. Type <code>/review</code> and keep the ones
        you want. Kizuki uses nothing you didn&apos;t confirm.
      </>
    ),
  },
  {
    title: "Explain one without your notes",
    text: "Write it the way you would explain it to a classmate. Kizuki keeps the material hidden until you finish, because recalling it beats rereading it.",
  },
  {
    title: "Answer the student’s questions",
    text: "Up to three rounds. Kizuki asks where your explanation disagrees with the material, what the material says that you left out, and what you meant by vague words.",
  },
  {
    title: "Confirm what you missed",
    text: "You tick the points you missed, then read the passages. After misses, you can try again right away. After a clean session Kizuki waits twice as long before the next review; after a miss, the concept comes back tomorrow. If you set an exam date, Kizuki moves reviews before it.",
  },
]

const COMMANDS = [
  ["/add notes.pdf", "Add a file. Dropping it onto the window does the same."],
  ["/review", "Confirm the concepts and the order Kizuki suggests."],
  ["/teach", "Explain the first concept that is due."],
  [
    "/due",
    "See what is due now, what comes next, and what waits on something else.",
  ],
  ["/exam 2026-12-15", "Move reviews before your exam."],
  ["/open 1", "Open source [1] in its file."],
]

function Section({
  id,
  title,
  lead,
  children,
}: {
  id: string
  title: string
  lead?: ReactNode
  children: ReactNode
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="mx-auto max-w-5xl scroll-mt-20 px-5 py-20 sm:py-28"
    >
      <h2
        id={`${id}-title`}
        className="text-center text-3xl font-semibold tracking-tight text-balance sm:text-5xl"
      >
        {title}
      </h2>
      {lead ? (
        <p className="mx-auto mt-4 max-w-2xl text-center text-lg text-pretty text-muted-foreground">
          {lead}
        </p>
      ) : null}
      <div className="mt-12 sm:mt-14">{children}</div>
    </section>
  )
}

function Seal({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block bg-foreground [mask:url(/seal-ki.svg)_center/contain_no-repeat]", className)}
    />
  )
}

export default function Page() {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-foreground focus:px-3 focus:py-2 focus:text-background"
      >
        Skip to the content
      </a>

      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-5">
          <Link
            href="/"
            className="flex min-h-11 items-center gap-2 font-semibold tracking-tight"
          >
            <Seal className="size-6" />
            Kizuki
          </Link>
          <nav aria-label="Site" className="flex items-center gap-1">
            {NAV.map((item) => (
              <Button
                key={item.href}
                asChild
                variant="ghost"
                size="sm"
                className={cn("h-11 px-2.5", item.hideBelow)}
              >
                <a href={item.href}>{item.label}</a>
              </Button>
            ))}
            <Button
              asChild
              variant="outline"
              size="sm"
              className="ml-1 h-9 gap-1"
            >
              <a href={GITHUB}>
                GitHub <ArrowUpRight data-icon="inline-end" aria-hidden />
              </a>
            </Button>
          </nav>
        </div>
      </header>

      <main id="main">
        <section
          aria-labelledby="title"
          className="relative overflow-hidden px-5 pt-20 pb-16 text-center sm:pt-28"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] bg-[radial-gradient(ellipse_at_top,var(--color-muted),transparent_70%)]"
          />
          <Badge variant="outline" className="h-7 rounded-full px-3 text-xs">
            Kizuki 1.0 runs in your terminal
          </Badge>
          <h1
            id="title"
            className="mt-6 text-5xl font-semibold tracking-tighter text-balance sm:text-7xl md:text-8xl"
          >
            Study smarter, not longer.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-pretty text-muted-foreground sm:text-xl">
            Kizuki turns your slides, PDFs, documents, and spreadsheets into a
            teach-back session in your terminal. You explain concepts from
            memory, and Kizuki questions your gaps by quoting directly from
            your material.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <CopyCommand command="npx kizuki" />
            <Button
              asChild
              variant="ghost"
              size="lg"
              className="h-11 rounded-full px-5 text-[0.95rem]"
            >
              <a href="#setup">What you need first</a>
            </Button>
          </div>
          <ul className="mx-auto mt-5 flex max-w-xl flex-col items-center gap-1 text-sm text-muted-foreground">
            <li>No account required. Runs directly in your terminal.</li>
            <li>
              Drop in PDFs, slides, Word, Excel, CSV, markdown, or text files.
              Kizuki reads them and remembers where every passage came from.
            </li>
          </ul>
          <p className="mt-4 text-xs text-muted-foreground">
            <span lang="ja">気付き</span> (kizuki) is Japanese for noticing, as
            in noticing a gap in what you know.
          </p>

          <div className="mt-14">
            <Terminal />
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            The question comes from a real session with the default small model
            on a laptop.
          </p>
        </section>

        <Section
          id="research"
          title="Built on how memory works."
          lead="Kizuki makes you recall, explain, and come back later. Decades of studies show those three habits beat rereading."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {RESEARCH.map((r) => (
              <Card key={r.figure} className="py-6">
                <CardContent className="flex flex-1 flex-col gap-3 px-6">
                  <p className="text-5xl font-semibold tracking-tighter tabular-nums sm:text-6xl">
                    {r.figure}
                  </p>
                  <p className="text-muted-foreground">{r.text}</p>
                </CardContent>
                <CardFooter className="px-6">
                  <a
                    href={r.href}
                    className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  >
                    {r.source}
                  </a>
                </CardFooter>
              </Card>
            ))}
          </div>

          <h3 className="mt-20 text-center text-2xl font-semibold tracking-tight sm:text-3xl">
            Kizuki, measured.
          </h3>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {MEASURED.map((m) => (
              <Card key={m.figure} className="py-6">
                <CardContent className="flex flex-col gap-3 px-6">
                  <p className="text-5xl font-semibold tracking-tighter tabular-nums">
                    {m.figure}
                  </p>
                  <p className="text-muted-foreground">{m.text}</p>
                </CardContent>
              </Card>
            ))}
          </div>
          <p className="mx-auto mt-8 max-w-xl text-center text-xs text-muted-foreground">
            The study numbers come from published research on these methods, not
            from Kizuki users.{" "}
            <a
              href="/docs/documents/How_people_learn.html"
              className="underline underline-offset-4 hover:text-foreground"
            >
              Read the full research summary
            </a>
            .
          </p>
        </Section>

        <Separator className="mx-auto max-w-5xl" />

        <Section id="how" title="How a session goes.">
          <ol className="mx-auto grid max-w-3xl gap-0">
            {STEPS.map((step, i) => (
              <li
                key={step.title}
                className="relative flex gap-5 pb-10 last:pb-0"
              >
                <div className="flex flex-col items-center">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full border bg-background text-sm font-semibold tabular-nums">
                    {i + 1}
                  </span>
                  {i < STEPS.length - 1 ? (
                    <span aria-hidden className="mt-2 w-px flex-1 bg-border" />
                  ) : null}
                </div>
                <div className="pt-1.5">
                  <h3 className="text-lg font-semibold tracking-tight">
                    {step.title}
                  </h3>
                  <p className="mt-1.5 text-muted-foreground [&_code]:text-foreground">
                    {step.text}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </Section>

        <Separator className="mx-auto max-w-5xl" />

        <Section
          id="commands"
          title="A few commands."
          lead={
            <>
              Kizuki runs in your terminal like a coding agent. Type{" "}
              <code className="text-foreground">/</code> to see every command,
              or <code className="text-foreground">/help</code> for what each
              one does.
            </>
          }
        >
          <Card className="mx-auto max-w-3xl py-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-48 pl-6">Command</TableHead>
                  <TableHead>What it does</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {COMMANDS.map(([cmd, what]) => (
                  <TableRow key={cmd}>
                    <TableCell className="pl-6 align-top font-mono text-[13px] font-medium">
                      {cmd}
                    </TableCell>
                    <TableCell className="pr-6 whitespace-normal text-muted-foreground">
                      {what}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </Section>

        <section
          aria-label="What Kizuki promises"
          className="mx-auto grid max-w-5xl gap-4 px-5 pb-20 sm:pb-28 md:grid-cols-2"
        >
          <Card className="py-8">
            <CardHeader className="px-8">
              <h2 className="text-3xl font-semibold tracking-tight">
                It only quotes your material.
              </h2>
              <p className="mt-2 text-muted-foreground">
                Kizuki&apos;s model can&apos;t write facts, quotes, or questions
                in its own words. The code checks this before you see anything.
              </p>
            </CardHeader>
            <CardContent className="px-8">
              <ul className="divide-y border-t text-[15px]">
                <li className="py-3">
                  The model only points at sentences of your material. Kizuki
                  shows those sentences word for word.
                </li>
                <li className="py-3">
                  Kizuki writes each question from a fixed template around the
                  exact sentence, with a link to where it came from.
                </li>
                <li className="py-3">
                  If nothing in your material matches what you wrote, Kizuki
                  says “not in your material” and asks nothing.
                </li>
                <li className="py-3">
                  When you and your material disagree, you decide. If the slide
                  had a typo, you correct it, and Kizuki uses your version from
                  then on.
                </li>
              </ul>
            </CardContent>
          </Card>
          <Card className="py-8">
            <CardHeader className="px-8">
              <h2 className="text-3xl font-semibold tracking-tight">
                It stays on your computer.
              </h2>
              <p className="mt-2 text-muted-foreground">
                You don&apos;t need an account. Kizuki runs a small model
                through Ollama, and it keeps your files and history in one
                folder you can copy or delete.
              </p>
            </CardHeader>
            <CardContent className="px-8">
              <ul className="divide-y border-t text-[15px] [&_code]:font-mono [&_code]:text-[13px]">
                <li className="py-3">
                  Your data: <code>~/.kizuki</code>
                </li>
                <li className="py-3">
                  Default models: <code>qwen3.5:2b</code> and{" "}
                  <code>nomic-embed-text</code>
                </li>
                <li className="py-3">
                  You can use MLX on Apple chips, or bigger hosted models with
                  your own Vercel AI Gateway key (<code>/model gateway</code>).
                  Before Kizuki sends anything off your computer, it asks you.
                </li>
              </ul>
            </CardContent>
          </Card>
        </section>

        <Separator className="mx-auto max-w-5xl" />

        <Section id="setup" title="Set up.">
          <ol className="mx-auto flex max-w-2xl flex-col gap-10">
            <li className="flex gap-5">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-foreground text-sm font-semibold text-background">
                1
              </span>
              <div className="pt-1.5">
                <h3 className="text-lg font-semibold tracking-tight">
                  Install Node.js and Ollama
                </h3>
                <p className="mt-1.5 text-muted-foreground">
                  <a
                    href="https://nodejs.org"
                    className="text-foreground underline underline-offset-4"
                  >
                    Node.js
                  </a>{" "}
                  22.18 or newer, and{" "}
                  <a
                    href="https://ollama.com"
                    className="text-foreground underline underline-offset-4"
                  >
                    Ollama
                  </a>
                  .
                </p>
              </div>
            </li>
            <li className="flex gap-5">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-foreground text-sm font-semibold text-background">
                2
              </span>
              <div className="min-w-0 flex-1 pt-1.5">
                <h3 className="text-lg font-semibold tracking-tight">
                  Download the two models
                </h3>
                <Code>
                  {"ollama pull qwen3.5:2b\nollama pull nomic-embed-text"}
                </Code>
              </div>
            </li>
            <li className="flex gap-5">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-foreground text-sm font-semibold text-background">
                3
              </span>
              <div className="min-w-0 flex-1 pt-1.5">
                <h3 className="text-lg font-semibold tracking-tight">
                  Start Kizuki
                </h3>
                <Code>npx kizuki</Code>
                <p className="mt-3 text-muted-foreground [&_code]:font-mono [&_code]:text-[13px] [&_code]:text-foreground">
                  It checks the models and starts in your terminal. Type{" "}
                  <code>/help</code> for commands. To keep it installed, run{" "}
                  <code>npm install -g kizuki</code> and start it with{" "}
                  <code>kizuki</code>.
                </p>
              </div>
            </li>
          </ol>
        </Section>
      </main>

      <footer className="border-t bg-muted/40">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-1 px-5 py-6 text-sm text-muted-foreground">
          <span className="flex items-center gap-2">
            <Seal className="size-4" />
            Kizuki is free and open source under the Apache 2.0 license.
          </span>
          <a
            href={GITHUB}
            className="inline-flex min-h-11 items-center hover:text-foreground"
          >
            Source and issues on GitHub
          </a>
          <a
            href="/docs/"
            className="inline-flex min-h-11 items-center hover:text-foreground"
          >
            Code docs
          </a>
        </div>
      </footer>
    </>
  )
}

function Code({ children }: { children: string }) {
  return (
    <pre className="mt-3 overflow-x-auto rounded-lg bg-[#161618] px-4 py-3 font-mono text-[13px] leading-relaxed text-[#e6e6e6]">
      <code>{children}</code>
    </pre>
  )
}
