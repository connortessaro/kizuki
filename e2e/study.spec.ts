import { expect, test } from "@playwright/test";
import { makeDocx, makePdf } from "../lib/test-helpers/fixtures";

// The whole study loop in a real browser against the built app, with a fake model server
// (e2e/fake-model.mjs) so every run is the same.

const HEART = `# Heart

The human heart has four chambers. Blood enters the right atrium
from the body and leaves through the aorta.

# Lungs

The lungs exchange oxygen and carbon dioxide in the alveoli.
`;

test("add material, confirm concepts and links, teach back, correct the material, and record a catch", async ({ page }) => {
  await page.goto("/courses");
  await page.getByPlaceholder("Course name").fill("Biology");
  await page.getByRole("button", { name: "Create course" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Biology" })).toBeVisible();

  await page.locator('input[name="files"]').setInputFiles([
    { name: "heart.md", mimeType: "text/markdown", buffer: Buffer.from(HEART) },
    { name: "cells.pdf", mimeType: "application/pdf", buffer: Buffer.from(makePdf([["Cells", "Mitochondria are found in all eukaryotic cells", "except mature red blood cells."]])) },
    { name: "notes.docx", mimeType: "application/octet-stream", buffer: Buffer.from(makeDocx([{ style: "Heading1", text: "Enzymes" }, { text: "Enzymes speed up reactions." }])) },
  ]);
  await page.getByRole("button", { name: "Add files" }).click();
  await expect(page.getByText("ready for your review")).toHaveCount(3, { timeout: 60_000 });

  // A sentence wrapped over two printed lines is quoted whole.
  await expect(page.getByText("“Blood enters the right atrium from the body and leaves through the aorta.”")).toBeVisible();

  while (await page.getByRole("button", { name: "Confirm all from this file" }).count()) {
    await page.getByRole("button", { name: "Confirm all from this file" }).first().click();
    await page.waitForLoadState("networkidle");
  }
  while (await page.getByRole("button", { name: "Done reviewing: suggest links" }).count()) {
    await page.getByRole("button", { name: "Done reviewing: suggest links" }).first().click();
    await page.waitForLoadState("networkidle");
  }
  await expect(page.getByText("done", { exact: true })).toHaveCount(3, { timeout: 60_000 });
  const suggested = page.locator("li", { hasText: "first" }).filter({ has: page.getByRole("button", { name: "Confirm" }) });
  await expect(suggested).toHaveCount(1);
  await suggested.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("Confirmed order")).toBeVisible();

  await page.getByRole("link", { name: "Heart", exact: true }).click();
  await page.locator("#explanation").fill("The heart has three chambers. Blood goes into the right atrium and out through the aorta.");
  await page.getByRole("button", { name: "Start teach-back" }).click();

  const question = page.locator(".question.contradiction");
  await expect(question).toContainText("says: “The human heart has four chambers.” You wrote: “three”. How does that fit?", { timeout: 60_000 });
  await question.getByLabel(/The material is wrong/).check();
  await question.getByPlaceholder("If the material is wrong: the correct version").fill("The human heart has three chambers.");
  await question.getByPlaceholder("Your answer").fill("My teacher corrected this slide.");
  await page.getByRole("button", { name: "Send and finish" }).click();

  // The model points at the sentence you just corrected; Kizuki must leave it out.
  const review = page.locator("form", { has: page.getByRole("button", { name: "Finish session" }) });
  await expect(review).toBeVisible({ timeout: 60_000 });
  await expect(review).not.toContainText("four chambers");
  await page.getByRole("button", { name: "Finish session" }).click();
  await expect(page.getByText(/Clean session/)).toBeVisible({ timeout: 30_000 });

  await page.getByPlaceholder("What you would have gotten wrong").fill("How many chambers");
  await page.getByRole("button", { name: "Record a catch" }).click();
  await expect(page.getByText("Catch recorded.")).toBeVisible();

  // Your correction shows under the quote it corrects.
  await page.getByRole("link", { name: "Heart" }).first().click();
  await expect(page.getByText("Your correction: “The human heart has four chambers.” should be “The human heart has three chambers.”")).toBeVisible();

  // A confirmed concept can still be renamed.
  await page.getByText("Change this concept").click();
  await page.getByLabel("New name").fill("Heart chambers");
  await page.getByRole("button", { name: "Rename" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Heart chambers" })).toBeVisible();

  await page.goto("/");
  await expect(page.getByText("1 catch this week")).toBeVisible();
});

test("refuses requests addressed to another name, on pages and on background-job routes", async ({ request }) => {
  const foreign = { host: "evil.example:4871" };
  expect((await request.get("/", { headers: foreign })).status()).toBe(403);
  const job = await request.post("/.well-known/workflow/v1/flow", {
    headers: { ...foreign, "x-vqs-queue-name": "__wkf_workflow_x", "x-vqs-message-id": "m1", "x-vqs-message-attempt": "1" },
    data: "{}",
  });
  expect(job.status()).toBe(403);
});

test("sends headers that stop other sites from framing Kizuki or reading its files as another type", async ({ request }) => {
  const res = await request.get("/courses");
  expect(res.headers()["x-frame-options"]).toBe("DENY");
  expect(res.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  expect(res.headers()["referrer-policy"]).toBe("no-referrer");
});
