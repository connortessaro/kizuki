"use server";

import { redirect } from "next/navigation";
import { vaultDir } from "../../../lib/data.mjs";
import { askService } from "../../../../lib/askCommands.mjs";

export async function askAction(formData: FormData): Promise<void> {
  const question = String(formData.get("question") ?? "").trim();
  if (!question) redirect("/ask");
  redirect(`/ask?q=${encodeURIComponent(question)}`);
}

export async function runAsk(question: string) {
  return askService(vaultDir(), question, { k: 6 });
}
