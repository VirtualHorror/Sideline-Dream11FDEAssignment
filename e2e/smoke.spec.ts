/**
 * Smoke tests for every user-facing route. Later tasks append their routes to ROUTES;
 * each route must pass all checks below on desktop and mobile.
 */
import { expect, type Page, test } from "@playwright/test";

const ROUTES = ["/"];
const ATTRIBUTION =
  "Made with 💖 by Nabhanyu for Dream11 - Forward Deployed Engineer Intern - Assignment";

/** Collects uncaught exceptions and console errors (CSP violations surface as console errors). */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  return errors;
}

for (const route of ROUTES) {
  test(`${route} renders the attribution line with no errors`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(route);
    await expect(page.getByRole("contentinfo")).toContainText(ATTRIBUTION);
    expect(errors).toEqual([]);
  });

  test(`${route} has no horizontal scroll`, async ({ page }) => {
    await page.goto(route);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test("theme choice applies immediately and survives a reload", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByRole("radio", { name: "Dark" }).check({ force: true });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ path: testInfo.outputPath("home-dark.png"), fullPage: true });

  await page.getByRole("radio", { name: "Light" }).check({ force: true });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.screenshot({ path: testInfo.outputPath("home-light.png"), fullPage: true });
});

test("Auto follows the device colour scheme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
