import { shownMessage } from "@/lib/messages";

/**
 * Shows the error or success message an action sent back. The page address only carries the
 * message's id; text typed into a link is never shown.
 */
export function Messages(params: { note?: string }) {
  const message = shownMessage(params);
  if (!message) return null;
  return <div className={`notice ${message.kind === "error" ? "error" : "good"}`}>{message.text}</div>;
}
