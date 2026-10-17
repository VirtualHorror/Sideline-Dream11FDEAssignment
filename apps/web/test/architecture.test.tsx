import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import architectureText from "../../../docs/Architecture.md?raw";
import decisionsText from "../../../docs/Decisions.md?raw";
import planText from "../../../docs/PLAN.md?raw";
import { renderMarkdown } from "../src/lib/markdown.ts";
import { Architecture } from "../src/pages/Architecture.tsx";

afterEach(cleanup);

// Expectations are read from the real docs, so the test fails if the page stops reflecting them.
const firstSection = architectureText
  .split("\n")
  .find((line) => line.startsWith("## "))
  ?.slice(3)
  .trim();
const taskTwoRow = planText
  .split("\n")
  .find((line) => /^\|\s*2\s*\|/.test(line))
  ?.split("|")
  .slice(1, -1)
  .map((cell) => cell.trim().replaceAll("`", ""));

describe("/architecture (PLAN 6.6b, D-034)", () => {
  it("renders docs/Architecture.md: its first section heading is on the page", () => {
    expect(firstSection).toBeTruthy();
    render(<Architecture />);
    expect(screen.getByRole("heading", { level: 2, name: firstSection })).toBeTruthy();
  });

  it("renders the PLAN checklist with Task 2's row as the file has it", () => {
    expect(taskTwoRow?.length).toBe(5);
    render(<Architecture />);
    const plan = screen.getByRole("region", { name: "Build plan" });
    const row = within(plan)
      .getAllByRole("row")
      .find((r) => r.textContent?.includes(taskTwoRow?.[1] ?? "?"));
    expect(row).toBeTruthy();
    expect(
      within(row as HTMLElement)
        .getAllByRole("cell")
        .map((c) => c.textContent),
    ).toEqual(taskTwoRow);
  });

  it("lists every decision, each collapsible", () => {
    const { container } = render(<Architecture />);
    const ids = decisionsText.match(/^### (D-\d{3})/gm)?.map((h) => h.slice(4)) ?? [];
    expect(ids.length).toBeGreaterThan(50);
    const entries = [...container.querySelectorAll("details[data-decision]")];
    expect(entries.map((d) => d.getAttribute("data-decision"))).toEqual(ids);
    const d034 = entries.find((d) => d.getAttribute("data-decision") === "D-034");
    expect(d034?.querySelector("summary")?.textContent).toContain("/architecture");
    expect(d034?.hasAttribute("open")).toBe(false);
  });
});

describe("markdown rendering (D-061)", () => {
  it("renders <script> as text, never as an element", () => {
    const { container } = render(
      <div>
        {renderMarkdown("Before <script>alert('x')</script> after\n\n<script src=x></script>")}
      </div>,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>alert('x')</script>");
  });

  it("keeps wide tables and code inside their own scrolling boxes", () => {
    const { container } = render(
      <div>{renderMarkdown("| a | b |\n| --- | --- |\n| 1 | 2 |\n\n```\nlong line\n```\n")}</div>,
    );
    expect(container.querySelector(".md-table > table")).toBeTruthy();
    expect(container.querySelector("pre.md-pre > code")?.textContent).toBe("long line\n");
  });

  it("opens web links in a new tab and turns repository paths into plain text", () => {
    const { container } = render(
      <div>{renderMarkdown("[Cricsheet](https://cricsheet.org) and [F05](features/F05.md)")}</div>,
    );
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://cricsheet.org");
    expect(link?.getAttribute("rel")).toBe("noreferrer");
    expect(container.querySelectorAll("a")).toHaveLength(1);
    expect(container.textContent).toContain("F05");
  });
});
