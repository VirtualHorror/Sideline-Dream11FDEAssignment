import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/App.tsx";

// The exact attribution line is a hard requirement from the brief: every page/view shows it.
const ATTRIBUTION =
  "Made with 💖 by Nabhanyu for Dream11 - Forward Deployed Engineer Intern - Assignment";

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-theme");
});

describe("App shell", () => {
  it("shows the attribution line and the Cricsheet data credit in the footer", () => {
    render(<App />);
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByText(ATTRIBUTION)).toBeTruthy();
    const credit = within(footer).getByRole("link", { name: /cricsheet/i });
    expect(credit.getAttribute("href")).toBe("https://cricsheet.org");
  });

  it("switches the document theme when the fan picks Light or Dark", async () => {
    render(<App />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: "Dark" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    await user.click(screen.getByRole("radio", { name: "Light" }));
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
