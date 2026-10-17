/**
 * PLAN 9.4: story mode end to end, on desktop and at 390 px, against the real (keyless) server. From
 * the landing page "Watch the story" opens the 2022 match as the plan's fan and stops, in order, at the
 * lineup patch, the comeback quest, the catch-up reel, the climax's teaser and its reveal, the room
 * read and the result, each with its card on screen. Then /architecture shows the pipeline, the live
 * "when we don't call AI" table (non-zero after the run) and the plan timeline. A reduced-motion run
 * leaves the tour and gets the room's controls back. No console errors anywhere.
 */
import { expect, type Page, test } from "@playwright/test";

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  return errors;
}

/** Each stop's card, as the feed marks it (data-kind, data-visibility). */
const STOPS = [
  ["lineup", '[data-kind="lineup_patch"][data-visibility="revealed"]'],
  ["bailout", '[data-kind="bailout"][data-visibility="revealed"]'],
  ["catch_up", '[data-kind="catch_up"][data-visibility="revealed"]'],
  ["teaser", '[data-kind="spoiler_nudge"][data-visibility="teaser"]'],
  ["reveal", '[data-kind="spoiler_nudge"][data-visibility="revealed"]'],
  ["room_read", '[data-kind="room_read"][data-visibility="revealed"]'],
  ["result", null],
] as const;

test("story mode stops at every beat of the 2022 match, then the AI-usage table counts it", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const errors = watchErrors(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Watch the story" }).click();
  await expect(page).toHaveURL(/\/match\/1298150\?persona=babar-believer&story=1$/);
  const story = page.getByRole("complementary", { name: "Story mode" });
  await expect(story).toContainText("watching as Captain Babar");

  for (const [stop, card] of STOPS) {
    const next = story.getByRole("button", { name: stop === "result" ? "Finish" : "Continue" });
    await expect(next, `the ${stop} stop`).toBeVisible({ timeout: 90_000 });
    if (card) await expect(page.locator(card).first()).toBeVisible();
    else await expect(story).toContainText("That's the match.");
    if (stop === "bailout" || stop === "room_read") {
      await page.screenshot({ path: testInfo.outputPath(`story-${stop}.png`) });
    }
    await next.click();
  }
  await expect(story).toContainText("That's the story.");

  await page.goto("/architecture");
  await expect(page.getByRole("img", { name: /How a delivery travels/ })).toBeVisible();
  const usage = page.getByRole("table", { name: "When Sideline does not call AI, live" });
  await expect(usage).toBeVisible();
  // The story's session played through the gate: events handled by rules alone are counted.
  await expect(usage.getByRole("row", { name: /Handled by rules/ })).toContainText(/[1-9]/);
  await expect(page.getByRole("list", { name: "Build plan" })).toContainText("Frontend II");
  expect(errors).toEqual([]);
});

test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("leaving the tour hands the room's controls back", async ({ page }, testInfo) => {
    const errors = watchErrors(page);
    await page.goto("/match/1298150?story=1");
    const story = page.getByRole("complementary", { name: "Story mode" });
    await expect(story).toBeVisible({ timeout: 30_000 });
    if (testInfo.project.name === "mobile") await page.getByRole("tab", { name: "TV" }).click();
    const pause = page.getByRole("button", { name: /^(Pause|Play)$/ });
    await expect(pause).toBeDisabled();
    await story.getByRole("button", { name: "Leave the tour" }).click();
    await expect(story).toBeHidden();
    await expect(pause).toBeEnabled();
    expect(errors).toEqual([]);
  });
});
