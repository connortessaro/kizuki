import { FatalError } from "workflow";
import { runHome } from "../lib/paths";

/**
 * The run's data folder, if it is the one Kizuki runs with ({@link runHome}). Any other
 * folder stops the run at once, without retries.
 */
export function ownHome(home: string): string {
  try {
    return runHome(home);
  } catch (error) {
    throw new FatalError((error as Error).message);
  }
}
