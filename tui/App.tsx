import { pathToFileURL } from "node:url";
import { Box, Static, Text, useApp, useInput, usePaste } from "ink";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Line, LineKind, Panel, Study } from "./study";

/** The slash commands, for the list shown while you type one. */
export const COMMANDS = [
  "/add",
  "/catch",
  "/concepts",
  "/correct",
  "/course",
  "/drop",
  "/due",
  "/exam",
  "/help",
  "/history",
  "/merge",
  "/model",
  "/open",
  "/quit",
  "/rebuild",
  "/rename",
  "/review",
  "/teach",
];

const COLORS: Record<LineKind, string | undefined> = {
  info: undefined,
  error: "red",
  you: "gray",
  kizuki: "cyan",
  source: "blue",
  heading: "magenta",
  hint: "gray",
  done: "green",
};

/** Wraps text in a terminal link (OSC 8), which iTerm2, Ghostty, WezTerm, and VS Code open on click. */
export function terminalLink(
  text: string,
  file: { path: string; page?: number },
): string {
  const url =
    pathToFileURL(file.path).href + (file.page ? `#page=${file.page}` : "");
  return `\u001b]8;;${url}\u0007${text}\u001b]8;;\u0007`;
}

function LineView({ line }: { line: Line }) {
  const text = line.file ? terminalLink(line.text, line.file) : line.text;
  const prefix = line.kind === "you" ? "›" : line.kind === "error" ? "✗" : line.kind === "done" ? "✓" : " ";
  // The prefix sits in its own column, so long lines wrap under the text, not under the mark.
  return (
    <Box>
      <Box width={2} flexShrink={0}>
        <Text color={COLORS[line.kind]}>{prefix}</Text>
      </Box>
      <Text color={COLORS[line.kind]} bold={line.kind === "heading"} dimColor={line.kind === "hint"}>
        {text}
      </Text>
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
      borderColor="cyan"
      paddingX={1}
    >
      <Text bold>{panel.title}</Text>
      {panel.items.map((item, i) => (
        <Text key={item.id} color={i === cursor ? "cyan" : undefined}>
          {i === cursor ? "❯ " : "  "}
          {panel.multi ? (checked.has(item.id) ? "◉ " : "◯ ") : ""}
          {item.label}
          {item.detail ? <Text dimColor> {item.detail}</Text> : null}
        </Text>
      ))}
      <Text dimColor>
        {panel.multi
          ? "↑↓ move · space ticks · enter confirms · esc stops"
          : "↑↓ move · enter picks · esc stops"}
      </Text>
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
  const hints =
    value.startsWith("/") && !value.includes(" ")
      ? COMMANDS.filter((c) => c.startsWith(value)).slice(0, 8)
      : [];
  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor="gray" paddingX={1}>
        <Text>
          <Text color="cyan">{prompt === ">" ? "›" : `${prompt} ›`}</Text>{" "}
          {value}
          <Text inverse> </Text>
        </Text>
      </Box>
      {hints.length > 0 ? (
        <Text dimColor>{`  ${hints.join("  ")}`}</Text>
      ) : null}
      {ctrlC ? <Text dimColor> Press Ctrl+C again to quit.</Text> : null}
    </Box>
  );
}

/** The whole screen: the top line, the conversation, any pick list, and the input. */
export function App({ study }: { study: Study }) {
  const view = useSyncExternalStore(
    (listener) => study.subscribe(listener),
    () => study.view(),
  );
  const { exit } = useApp();
  const [dots, setDots] = useState(0);
  useEffect(() => {
    if (!view.status.busy) return;
    const timer = setInterval(() => setDots((d) => (d + 1) % 4), 300);
    return () => clearInterval(timer);
  }, [view.status.busy]);
  const status = [
    "kizuki",
    view.status.course ?? "no course",
    `${view.status.due} due`,
    view.status.model,
  ].filter(Boolean);
  return (
    <>
      <Static items={view.lines}>
        {(line) => <LineView key={line.id} line={line} />}
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
        <Text dimColor>
          {status.join(" · ")}
          {view.status.busy ? (
            <Text color="yellow">{` · ${view.status.busy}${".".repeat(dots)}`}</Text>
          ) : null}
        </Text>
      </Box>
    </>
  );
}
