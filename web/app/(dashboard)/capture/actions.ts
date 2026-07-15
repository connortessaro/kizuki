"use server";

import { redirect } from "next/navigation";
import { vaultDir } from "../../../lib/data.mjs";
import { buildCaptureInput, captureFromWeb } from "../../../lib/api.mjs";

function fieldString(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export async function captureAction(formData: FormData): Promise<void> {
  if (process.env.KIZUKI_DEMO) {
    redirect(`/capture?error=${encodeURIComponent("Capture is disabled in the demo.")}`);
  }
  let captureId: string;
  try {
    const input = buildCaptureInput({
      kind: fieldString(formData, "kind"),
      text: fieldString(formData, "text"),
      entityType: fieldString(formData, "entityType"),
      entityName: fieldString(formData, "entityName"),
    });
    const result = await captureFromWeb(vaultDir(), input);
    captureId = result.event.aggregate.id;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Capture failed.";
    redirect(`/capture?error=${encodeURIComponent(message)}`);
  }
  redirect(`/capture?captured=${encodeURIComponent(captureId)}`);
}
