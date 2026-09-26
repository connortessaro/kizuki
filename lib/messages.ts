import { randomBytes } from "node:crypto";

/** The two kinds of message an action sends back: an error, or a note that it worked. */
export type MessageKind = "error" | "done";

/** A message an action sent back. */
export interface Message {
  /** `error` if the action failed, `done` if it worked. */
  kind: MessageKind;
  /** The words shown on the page. */
  text: string;
}

// Messages are kept here, on globalThis so every part of the app that loads this file shares
// them, and only a random id goes in the page address. A restart forgets them, which is harmless.
const KEY = Symbol.for("kizuki.messages");
const store = globalThis as unknown as Record<symbol, Map<string, Message> | undefined>;
const messages = (store[KEY] ??= new Map());

/** The most messages kept at once. Older ones are forgotten. */
export const MAX_MESSAGES = 200;

/** The address to go back to, carrying the id of a message only this running Kizuki knows. */
export function withMessage(path: string, kind: MessageKind, text: string): string {
  const id = randomBytes(12).toString("base64url");
  messages.set(id, { kind, text });
  while (messages.size > MAX_MESSAGES) messages.delete(messages.keys().next().value!);
  return `${path}${path.includes("?") ? "&" : "?"}note=${id}`;
}

/**
 * The message to show for a page address: only one Kizuki itself stored with
 * {@link withMessage}. Text someone typed into a link is never shown, so a link can't make a
 * page show instructions that look like Kizuki's.
 */
export function shownMessage(params: { note?: string }): Message | undefined {
  return params.note ? messages.get(params.note) : undefined;
}
