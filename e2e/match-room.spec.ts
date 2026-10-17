/**
 * PLAN 6.6: the match room against the real (keyless) server, on desktop and at 390 px.
 *
 * From the landing page a fan picks a persona and starts watching; then jumps to after 18 overs of the
 * chase at 16x with a 25 s delay. The 18.6 teaser reaches the browser at stadium time, so its card must
 * appear veiled (nothing of the ball in it) and reveal only when the fan's TV gets to the ball (about
 * 19 s of wall time after the jump, then 1.6 s of delay). The control plane must count deterministic
 * events. Screenshots in both themes land in test-results/ for the visual review.
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
  await page.getByRole("button", { name: "OTT app, 25 s" }).click();
  await expect(page.getByRole("slider", { name: /25 s behind the ground/ })).toBeVisible();
  await page.getByRole("radio", { name: "16x" }).check({ force: true });
  await page.getByRole("combobox", { name: "Innings" }).selectOption("2");
  await page.getByRole("combobox", { name: "After overs" }).selectOption("18");
  await page.getByRole("button", { name: "Jump" }).click();

  await openTab("Companion");
  const card = page.locator('[data-kind="spoiler_nudge"][data-ball="18.6"]');
  await expect(card).toHaveAttribute("data-visibility", "hidden", { timeout: 45_000 });
  await expect(card).toContainText("Held for your TV");
  await expect(card).not.toContainText(/144\/4|Rauf to Kohli/);
  await page.screenshot({ path: testInfo.outputPath("room-held.png"), fullPage: true });

  await expect(card).toHaveAttribute("data-visibility", "revealed", { timeout: 15_000 });
  await expect(card).toContainText("18.6 Rauf to Kohli, six");
  await expect(card).toContainText("Fallback: AI unavailable");

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
