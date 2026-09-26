import type { Passage } from "./events";
import { kizukiHome } from "./paths";
import { localDate } from "./schedule";
import { describeLocation } from "./sources";
import { loadPassages, loadState, type State } from "./state";

/** Everything a page needs: the home folder, the current state, and every passage. */
export interface PageData {
  /** The home folder: `KIZUKI_HOME` if set, otherwise `~/.kizuki`. */
  home: string;
  /** The current state, rebuilt from the logs. */
  state: State;
  /** Every passage, by passage id. */
  passages: Map<string, Passage>;
  /** Today's date as `YYYY-MM-DD`, in the computer's time zone. */
  today: string;
}

/** Loads the current state and passages for a page. Always reads fresh from the logs. */
export async function loadPageData(): Promise<PageData> {
  const home = kizukiHome();
  const [state, passages] = await Promise.all([loadState(home), loadPassages(home)]);
  return { home, state, passages, today: localDate(new Date().toISOString()) };
}

/** A plain description of where a passage is, such as "Page 4 of ch1.pdf". */
export function passageLabel(data: Pick<PageData, "state" | "passages">, passageId: string): string {
  const p = data.passages.get(passageId);
  if (!p) return "Your material";
  return describeLocation(p.location, data.state.materials.get(p.materialId)?.fileName ?? "your material");
}
