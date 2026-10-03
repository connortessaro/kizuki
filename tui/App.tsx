import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { Box, Static, Text, useApp, useInput, usePaste } from "ink";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Line, Panel, Study } from "./study";

/** The slash commands and what each does, for the list shown while you type one. */
export const COMMAND_HELP: Record<string, string> = {
  "/add": "add files to the course",
  "/catch": "record something you would have gotten wrong",
  "/concepts": "the course's confirmed concepts",
  "/correct": "the material in a source is wrong",
  "/course": "switch course, or make a new one",
  "/drop": "drop a concept",
  "/due": "what is due, coming up, and waiting",
  "/exam": "set the exam date",
  "/help": "every command",
  "/history": "the last 8 weeks",
  "/links": "the confirmed order",
  "/merge": "merge one concept into another",
  "/model": "show or change models",
  "/open": "open a source at its page",
  "/quit": "leave Kizuki",
  "/rebuild": "rebuild the search file",
  "/rename": "rename a concept",
  "/review": "confirm proposed concepts and links",
  "/teach": "teach a concept back from memory",
};

/** The slash commands, for completion with Tab. */
export const COMMANDS = Object.keys(COMMAND_HELP);

/** The few colors the screen uses. Hex, so they look the same in every terminal theme that shows true color. */
export const THEME = {
  accent: "#0A84FF",
  quote: "#FFD60A",
  link: "#64D2FF",
  good: "#30D158",
  bad: "#FF453A",
  dim: "gray",
};

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Wraps text in a terminal link (OSC 8), which iTerm2, Ghostty, WezTerm, and VS Code open on click. */
export function terminalLink(
  text: string,
  file: { path: string; page?: number },
): string {
  const url =
    pathToFileURL(file.path).href + (file.page ? `#page=${file.page}` : "");
  return `\u001b]8;;${url}\u0007${text}\u001b]8;;\u0007`;
}

/** Shows quoted material (between “ and ”) in the quote color, so it stands out from Kizuki's own template words. */
function WithQuotes({ text }: { text: string }) {
  const parts = text.split(/(“[^”]*”)/);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("“") ? (
          <Text key={i} color={THEME.quote}>
            {part}
          </Text>
        ) : (
          part
        ),
      )}
    </>
  );
}

const MARKS: Partial<Record<Line["kind"], { mark: string; color?: string }>> = {
  you: { mark: "›", color: THEME.dim },
  kizuki: { mark: "●", color: THEME.accent },
  source: { mark: "⎿", color: THEME.dim },
  heading: { mark: "◆", color: THEME.accent },
  done: { mark: "✓", color: THEME.good },
  error: { mark: "✗", color: THEME.bad },
};

function LineView({ line }: { line: Line }) {
  const mark = MARKS[line.kind];
  const text = line.file ? terminalLink(line.text, line.file) : line.text;
  const spaced =
    line.kind === "you" || line.kind === "heading" || line.kind === "kizuki";
  // The mark sits in its own column, so long lines wrap under the text, not under the mark.
  return (
    <Box
      marginTop={spaced ? 1 : 0}
      paddingLeft={line.kind === "source" ? 2 : 0}
    >
      <Box width={2} flexShrink={0}>
        <Text color={mark?.color}>{mark?.mark ?? " "}</Text>
      </Box>
      {line.kind === "kizuki" ? (
        <Text>
          <WithQuotes text={text} />
        </Text>
      ) : line.kind === "source" ? (
        <Text color={THEME.link}>
          <WithQuotes text={text} />
        </Text>
      ) : (
        <Text
          color={
            line.kind === "error"
              ? THEME.bad
              : line.kind === "you"
                ? THEME.dim
                : undefined
          }
          bold={line.kind === "heading"}
          dimColor={line.kind === "hint"}
        >
          {text}
        </Text>
      )}
    </Box>
  );
}

/** A path with the home folder written as ~. */
function short(path: string): string {
  const h = homedir();
  return path === h || path.startsWith(`${h}/`) ? `~${path.slice(h.length)}` : path;
}

function Welcome({ version, home }: { version: string; home: string }) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={THEME.accent}
      paddingX={1}
      marginBottom={1}
    >
      <Text>
        <Text color={THEME.accent} bold>
          気{" "}
        </Text>
        <Text bold>Kizuki</Text>
        <Text dimColor> {version}</Text>
      </Text>
      <Text dimColor>
        Teach a concept back. Kizuki plays the student and quotes your material.
      </Text>
      <Text dimColor>Data: {short(home)}</Text>
    </Box>
  );
}

function PanelView({
  panel,
  onPick,
  onCancel,
}: {
  panel: Panel;
  onPick: (ids: string[]) => void;
  onCancel: () => void;
}) {
  const [cursor, setCursor] = useState(0);
  const [checked, setChecked] = useState(
    () => new Set(panel.items.filter((i) => i.checked).map((i) => i.id)),
  );
  useInput((input, key) => {
    if (key.escape) return onCancel();
    if (key.upArrow)
      return setCursor(
        (c) => (c + panel.items.length - 1) % panel.items.length,
      );
    if (key.downArrow) return setCursor((c) => (c + 1) % panel.items.length);
    if (panel.multi && input === " ") {
      const id = panel.items[cursor]!.id;
      return setChecked((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }
    if (key.return)
      onPick(
        panel.multi
          ? panel.items.filter((i) => checked.has(i.id)).map((i) => i.id)
          : [panel.items[cursor]!.id],
      );
  });
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={THEME.accent}
      paddingX={1}
    >
      <Text bold>{panel.title}</Text>
      <Box flexDirection="column" marginTop={1}>
        {panel.items.map((item, i) => {
          const here = i === cursor;
          const on = checked.has(item.id);
          return (
            <Text
              key={item.id}
              color={here ? THEME.accent : undefined}
              bold={here}
            >
              {here ? "❯ " : "  "}
              {panel.multi ? (
                <Text color={on ? THEME.accent : THEME.dim}>
                  {on ? "◉ " : "◯ "}
                </Text>
              ) : null}
              <WithQuotes text={item.label} />
              {item.detail ? (
                <Text dimColor bold={false}>
                  {"  "}
                  {item.detail}
                </Text>
              ) : null}
            </Text>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          {panel.multi
            ? "↑↓ move  ·  space ticks  ·  enter confirms  ·  esc stops"
            : "↑↓ move  ·  enter picks  ·  esc stops"}
        </Text>
      </Box>
    </Box>
  );
}

function InputView({
  prompt,
  onSubmit,
  onCancel,
  onQuit,
}: {
  prompt: string;
  onSubmit: (text: string) => void;
  onCancel: () => void;
  onQuit: () => void;
}) {
  const [value, setValue] = useState("");
  const [ctrlC, setCtrlC] = useState(false);
  usePaste((text) => setValue((v) => v + text));
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      if (ctrlC) return onQuit();
      setValue("");
      return setCtrlC(true);
    }
    setCtrlC(false);
    if (key.escape) {
      setValue("");
      return onCancel();
    }
    if (key.return) {
      // A line ending in a backslash goes on to a new line instead of sending.
      if (value.endsWith("\\")) return setValue((v) => `${v.slice(0, -1)}\n`);
      const text = value;
      setValue("");
      return onSubmit(text);
    }
    if (key.backspace || key.delete) return setValue((v) => v.slice(0, -1));
    if (key.tab && value.startsWith("/")) {
      const matches = COMMANDS.filter((c) => c.startsWith(value));
      if (matches.length === 1) setValue(`${matches[0]} `);
      return;
    }
    if (!key.ctrl && !key.meta && input) setValue((v) => v + input);
  });
  const asking = prompt !== ">";
  const hints =
    value.startsWith("/") && !value.includes(" ")
      ? COMMANDS.filter((c) => c.startsWith(value)).slice(0, 8)
      : [];
  return (
    <Box flexDirection="column">
      {asking ? (
        <Text color={THEME.accent} bold>
          {prompt}
        </Text>
      ) : null}
      <Box
        borderStyle="round"
        borderColor={asking ? THEME.accent : THEME.dim}
        paddingX={1}
      >
        <Text>
          <Text color={asking ? THEME.accent : THEME.dim}>›</Text>{" "}
          {value ? (
            value
          ) : (
            <Text dimColor>
              {asking
                ? "Type your answer, then Enter"
                : "Type / for commands, or drop a file here"}
            </Text>
          )}
          <Text inverse> </Text>
        </Text>
      </Box>
      {hints.map((c) => (
        <Text key={c}>
          {"  "}
          <Text color={THEME.accent}>{c.padEnd(12)}</Text>
          <Text dimColor>{COMMAND_HELP[c]}</Text>
        </Text>
      ))}
      {ctrlC ? <Text dimColor> Press Ctrl+C again to quit.</Text> : null}
    </Box>
  );
}

type Item = { id: number; welcome: true } | Line;

/** The whole screen: a welcome card, the conversation, any pick list, the input, and the status line. */
export function App({
  study,
  version = "",
  home = "",
}: {
  study: Study;
  version?: string;
  home?: string;
}) {
  const view = useSyncExternalStore(
    (listener) => study.subscribe(listener),
    () => study.view(),
  );
  const { exit } = useApp();
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!view.status.busy) return;
    const timer = setInterval(
      () => setFrame((f) => (f + 1) % SPINNER.length),
      80,
    );
    return () => clearInterval(timer);
  }, [view.status.busy]);
  const items: Item[] = [{ id: 0, welcome: true }, ...view.lines];
  const status = [
    "kizuki",
    view.status.course ?? "no course",
    `${view.status.due} due`,
    view.status.model,
  ].filter(Boolean);
  return (
    <>
      <Static items={items}>
        {(item) =>
          "welcome" in item ? (
            <Welcome key="welcome" version={version} home={home} />
          ) : (
            <LineView key={item.id} line={item} />
          )
        }
      </Static>
      <Box flexDirection="column" marginTop={1}>
        {view.panel ? (
          <PanelView
            key={view.lines.length}
            panel={view.panel}
            onPick={(ids) => study.pick(ids)}
            onCancel={() => study.cancel()}
          />
        ) : (
          <InputView
            prompt={view.prompt}
            onSubmit={(text) => void study.submit(text)}
            onCancel={() => study.cancel()}
            onQuit={() => exit()}
          />
        )}
        <Box paddingX={1}>
          {view.status.busy ? (
            <Text color={THEME.accent}>
              {SPINNER[frame]} {view.status.busy}
              {"  "}
            </Text>
          ) : null}
          <Text dimColor>{status.join(" · ")}</Text>
        </Box>
      </Box>
    </>
  );
}
