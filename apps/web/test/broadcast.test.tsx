import { foldEvents, type MatchState } from "@sideline/engine";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Commentary } from "../src/broadcast/Commentary.tsx";
import { DelayControl } from "../src/broadcast/DelayControl.tsx";
import { InningsDotMatrix } from "../src/broadcast/InningsDotMatrix.tsx";
import { OverStrip } from "../src/broadcast/OverStrip.tsx";
import { PhaseRail } from "../src/broadcast/PhaseRail.tsx";
import { PlaybackControls } from "../src/broadcast/PlaybackControls.tsx";
import { Scorebug } from "../src/broadcast/Scorebug.tsx";
import { WinProbLine } from "../src/broadcast/WinProbLine.tsx";
import { delivery, events, MATCH_ID, players, summary, winprob } from "./helpers/match.ts";

afterEach(cleanup);

const playersById = new Map(players.map((p) => [p.id, p]));
const through = (innings: 1 | 2, label: string): MatchState =>
  foldEvents(MATCH_ID, events, delivery(innings, label).seq);
const fullMatch = foldEvents(MATCH_ID, events);
const chase = (state: MatchState) => {
  const innings = state.innings[1];
  if (!innings) throw new Error("no second innings");
  return innings;
};

/** One row of the matrix: each legal ball's class and the extras markers inside its cell. */
function row(container: HTMLElement, innings: number, over: number) {
  return [1, 2, 3, 4, 5, 6].map((ball) => {
    const cell = container.querySelector(
      `[data-innings="${innings}"] [data-label="${over}.${ball}"]`,
    );
    return {
      kind: cell?.getAttribute("data-ball") ?? null,
      marks: [...(cell?.querySelectorAll("[data-extra]") ?? [])].map(
        (m) =>
          `${m.getAttribute("data-extra")}${m.getAttribute("data-boundary") === "6" ? "+6" : ""}`,
      ),
    };
  });
}

describe("InningsDotMatrix (PLAN 6.4)", () => {
  // Literals read off the raw Cricsheet file (innings 2, overs 17-19), not from the engine.
  it("puts sixes, fours, wickets, dots and extras markers on the right cells of the chase", () => {
    const { container } = render(<InningsDotMatrix innings={chase(fullMatch)} />);
    const cells = container.querySelectorAll('[data-innings="2"] [data-label]');
    expect(cells).toHaveLength(120);

    expect(row(container, 2, 17)).toEqual([
      { kind: "four", marks: [] },
      { kind: "runs", marks: ["wd"] },
      { kind: "four", marks: [] },
      { kind: "runs", marks: [] },
      { kind: "runs", marks: [] },
      { kind: "four", marks: [] },
    ]);
    expect(row(container, 2, 18)).toEqual([
      { kind: "runs", marks: [] },
      { kind: "runs", marks: [] },
      { kind: "dot", marks: [] },
      { kind: "runs", marks: [] },
      { kind: "six", marks: [] },
      { kind: "six", marks: [] },
    ]);
    // 19.4: a no-ball hit for six, a wide, then three byes off the free hit; 19.6: a wide first.
    expect(row(container, 2, 19)).toEqual([
      { kind: "wicket", marks: [] },
      { kind: "runs", marks: [] },
      { kind: "runs", marks: [] },
      { kind: "byes", marks: ["nb+6", "wd"] },
      { kind: "wicket", marks: [] },
      { kind: "runs", marks: ["wd"] },
    ]);
  });

  it("leaves balls not yet bowled empty", () => {
    const { container } = render(<InningsDotMatrix innings={chase(through(2, "18.6"))} />);
    expect(row(container, 2, 19).map((c) => c.kind)).toEqual(new Array(6).fill("future"));
    expect(container.querySelectorAll('[data-innings="2"] [data-label]')).toHaveLength(120);
  });
});

describe("Scorebug (PLAN 6.4)", () => {
  it("shows the chase after 18.6 in tabular numerals", () => {
    const { container } = render(
      <Scorebug state={through(2, "18.6")} teams={summary.teams} players={playersById} />,
    );
    const bug = container.querySelector('[data-component="scorebug"]') as HTMLElement;
    expect(getComputedStyle(bug).fontVariantNumeric).toBe("tabular-nums");
    // 144/4 after the 18.6 six, 16 needed off the last 6 (F05 audit, re-derived in Python).
    expect(bug.textContent).toContain("144/4");
    expect(bug.textContent).toContain("Need 16 off 6");
    expect(bug.textContent).toContain("Kohli");
    expect(bug.textContent).toContain("74");
  });

  it("states the result once the match is over", () => {
    render(<Scorebug state={fullMatch} teams={summary.teams} players={playersById} />);
    expect(screen.getByText("India won by 4 wickets")).toBeTruthy();
  });
});

describe("OverStrip", () => {
  it("lists the current over ball by ball", () => {
    render(<OverStrip state={through(2, "18.6")} />);
    const strip = screen.getByRole("list", { name: "This over" });
    expect(
      within(strip)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["1", "1", "•", "1", "6", "6"]);
  });
});

describe("Commentary", () => {
  it("reads the latest balls newest first, with names from the data", () => {
    render(<Commentary state={through(2, "18.6")} events={events} players={playersById} />);
    const lines = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(lines[0]).toBe("18.6 Rauf to Kohli, six");
    expect(lines[1]).toBe("18.5 Rauf to Kohli, six");
  });
});

describe("WinProbLine", () => {
  it("charts the chasing side's chance, low at 90/4 and certain at the end", () => {
    const { rerender } = render(
      <WinProbLine
        events={events}
        released={delivery(2, "13.6").seq + 1}
        matchId={MATCH_ID}
        model={winprob}
        teams={summary.teams}
      />,
    );
    const summaryText = () => screen.getByRole("img").getAttribute("aria-label") ?? "";
    const pct = () => Number(summaryText().match(/(\d+)%/)?.[1]);
    expect(summaryText()).toContain("India");
    // PLAN 3.2's demo sanity: India below 35% after 13.6 of the chase.
    expect(pct()).toBeLessThan(35);
    rerender(
      <WinProbLine
        events={events}
        released={events.length}
        matchId={MATCH_ID}
        model={winprob}
        teams={summary.teams}
      />,
    );
    expect(pct()).toBe(100);
  });
});

describe("PhaseRail", () => {
  it("marks where the TV is and jumps to a phase's start", async () => {
    const onJump = vi.fn();
    render(<PhaseRail state={through(2, "18.6")} onJump={onJump} />);
    const current = screen.getByRole("button", { current: "step" });
    expect(current.getAttribute("data-phase")).toBe("2:death");
    await userEvent.click(screen.getByRole("button", { name: /1st innings powerplay/i }));
    expect(onJump).toHaveBeenCalledWith({ kind: "over", innings: 1, afterOvers: 0 });
    await userEvent.click(screen.getByRole("button", { name: /toss/i }));
    expect(onJump).toHaveBeenLastCalledWith({ kind: "toss" });
  });
});

describe("PlaybackControls and DelayControl", () => {
  it("sends play, pause, speed and a jump after N overs of an innings", async () => {
    const user = userEvent.setup();
    const onControl = vi.fn();
    render(<PlaybackControls playing speed={1} onControl={onControl} />);
    await user.click(screen.getByRole("button", { name: "Pause" }));
    expect(onControl).toHaveBeenLastCalledWith({ action: "pause" });
    await user.click(screen.getByRole("radio", { name: "16x" }));
    expect(onControl).toHaveBeenLastCalledWith({ action: "speed", value: 16 });
    await user.selectOptions(screen.getByRole("combobox", { name: "Innings" }), "2");
    await user.selectOptions(screen.getByRole("combobox", { name: "After overs" }), "18");
    await user.click(screen.getByRole("button", { name: "Jump" }));
    expect(onControl).toHaveBeenLastCalledWith({
      action: "jump",
      target: { kind: "over", innings: 2, afterOvers: 18 },
    });
  });

  it("sets the TV delay from a preset", async () => {
    const onControl = vi.fn();
    render(<DelayControl delayMs={15_000} onControl={onControl} />);
    expect(screen.getByRole("slider", { name: "Your TV is 15 s behind the ground" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /OTT app, 25 s/ }));
    expect(onControl).toHaveBeenLastCalledWith({ action: "delay", ms: 25_000 });
  });
});
