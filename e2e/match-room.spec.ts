/**
 * PLAN 6.6: the match room against the real server, on desktop and at 390 px; PLAN 7.4 runs this file
 * against the deployed site too (PLAYWRIGHT_BASE_URL).
 *
 * From the landing page a fan picks a persona and starts watching; then jumps to after 18 overs of the
 * chase at 16x with a 25 s delay. The 18.6 teaser reaches the browser at stadium time, so its card must
 * appear veiled (nothing of the ball in it) and reveal only when the fan's TV gets to the ball (about
 * 19 s of wall time after the jump, then 1.6 s of delay). A live model can answer after the TV has
 * shown the ball; the card then arrives revealed, never earlier (Review focus 3). The card's provenance
 * chip must say where its words came from (allowedProvenance). The control plane must count
 * deterministic events. Screenshots in both themes land in test-results/ for the visual review.
 */
import { existsSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

declare global {
  interface Window {
    /** Every state the 18.6 card showed, in order, with its text at the time (the climax test). */
    cardStates?: { state: string; text: string }[];
  }
}

const LABELS = {
  live: "Live AI",
  cache: "Cached for everyone at this moment",
  replay: "Replayed AI",
  fallback: "Fallback: AI unavailable",
} as const;

/**
 * The provenance labels the 18.6 card may show (D-054, D-066). The local test server is keyless, so
 * there is exactly one: replayed if this repository holds a recording of the match (`pnpm ai:record`
 * records every teaser), else the labelled fallback. A deployed server in replay mode replays or falls
 * back; with a key it may answer live or from the cache, a recording answers before any call, and a
 * failing provider (an account out of credit) falls back.
 */
function allowedProvenance(aiMode: string | null): string[] {
  if (!process.env.PLAYWRIGHT_BASE_URL) {
    const recorded = existsSync(new URL("../data/ai-replay/1298150.jsonl", import.meta.url));
    return [recorded ? LABELS.replay : LABELS.fallback];
  }
  return aiMode === "live" ? Object.values(LABELS) : [LABELS.replay, LABELS.fallback];
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  return errors;
}

test("a fan watches the climax: the teaser is held for their TV, then revealed", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const phone = testInfo.project.name === "mobile";
  const openTab = async (name: string) => {
    if (phone) await page.getByRole("tab", { name }).click();
  };

  await page.goto("/");
  await page.getByRole("radio", { name: /^Late from work/ }).check();
  await page.getByRole("button", { name: "Start watching" }).click();
  await expect(page).toHaveURL(/\/match\/1298150\?persona=late-from-work$/);
  // A 15 s feed shows 13.5 (89/4) until it reaches the join point at 13.6 (90/4).
  await expect(page.locator('[data-component="scorebug"]').first()).toContainText(/(89|90)\/4/);

  await openTab("TV");
  const aiMode = await page.locator("[data-ai-mode]").first().getAttribute("data-ai-mode");
  await page.getByRole("button", { name: "OTT app, 25 s" }).click();
  await expect(page.getByRole("slider", { name: /25 s behind the ground/ })).toBeVisible();
  await page.getByRole("radio", { name: "16x" }).check({ force: true });
  await page.getByRole("combobox", { name: "Innings" }).selectOption("2");
  await page.getByRole("combobox", { name: "After overs" }).selectOption("18");
  await page.getByRole("button", { name: "Jump" }).click();

  await openTab("Companion");
  // The page records every state the 18.6 card shows, as it happens: the hold lasts (25 - 6) / 16, about
  // 1.2 s of wall time, and Playwright's polls (up to 1 s apart) can miss it on a busy host (F07).
  await page.evaluate(() => {
    const states: { state: string; text: string }[] = [];
    window.cardStates = states;
    const record = () => {
      const shown = document.querySelector('[data-kind="spoiler_nudge"][data-ball="18.6"]');
      const state = shown?.getAttribute("data-visibility");
      if (shown && state && states.at(-1)?.state !== state) {
        states.push({ state, text: shown.textContent ?? "" });
      }
    };
    record();
    new MutationObserver(record).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-visibility"],
    });
  });
  const card = page.locator('[data-kind="spoiler_nudge"][data-ball="18.6"]');
  await expect(card).toBeAttached({ timeout: 45_000 });
  if ((await card.getAttribute("data-visibility")) === "hidden") {
    await page.screenshot({ path: testInfo.outputPath("room-held.png"), fullPage: true });
  }

  await expect(card).toHaveAttribute("data-visibility", "revealed", { timeout: 15_000 });
  await expect(card).toContainText("18.6 Rauf to Kohli, six");
  expect(allowedProvenance(aiMode)).toContain(await card.locator(".provenance").innerText());
  const states = (await page.evaluate(() => window.cardStates)) ?? [];
  // With no model call (replay mode) the card always comes 25 s ahead of the fan's TV, so it is held
  // first; a live answer slower than the fan's 1.6 s may only arrive once the TV showed the ball.
  if (aiMode !== "live") expect(states[0]?.state).toBe("hidden");
  expect(states.at(-1)?.state).toBe("revealed");
  for (const { state, text } of states.filter((s) => s.state !== "revealed")) {
    expect(text).not.toMatch(/144\/4|Rauf to Kohli/);
    if (state === "hidden") expect(text).toContain("Held for your TV");
  }

  await openTab("Control plane");
  if (!phone) await page.getByRole("button", { name: /^Control plane/ }).click();
  await expect(page.getByText(/^Events$/)).toBeVisible();
  const handled = page.locator(".cp-counter", { hasText: "Handled without AI" });
  await expect(handled).toContainText(/[1-9]\d* of \d+/, { timeout: 10_000 });

  await page.getByRole("radio", { name: "Dark" }).check({ force: true });
  await page.screenshot({ path: testInfo.outputPath("room-dark.png"), fullPage: true });
  await page.getByRole("radio", { name: "Light" }).check({ force: true });
  await page.screenshot({ path: testInfo.outputPath("room-light.png"), fullPage: true });

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test("the scorebug uses tabular numerals in the browser", async ({ page }) => {
  await page.goto("/match/1298150?persona=late-from-work");
  const bug = page.locator('[data-component="scorebug"]').first();
  await expect(bug).toContainText(/(89|90)\/4/);
  expect(await bug.evaluate((el) => getComputedStyle(el).fontVariantNumeric)).toBe("tabular-nums");
});

test("effects fall back under reduced motion: no canvas, static floodlight", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sideline", level: 1 })).toBeVisible();
  await expect(page.locator('[data-effect="floodlight"]')).toHaveAttribute("data-motion", "static");
  await expect(page.locator('[data-effect="ghost"]')).toHaveAttribute("data-render", "css");
  await expect(page.locator("canvas")).toHaveCount(0);
});
