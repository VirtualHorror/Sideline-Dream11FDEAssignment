/**
 * PLAN 9.1: the Task 9 cards render their payloads and provenance, each held until the fan's TV
 * shows what triggered it; quest predictions turn won or lost as deliveries reach the TV (the engine's
 * resolver, never the card). Payloads are labelled test fixtures with real ids and names from
 * players.json (DOMAIN §4: Fakhar Zaman and Rishabh Pant sat out; Babar Azam fell at 1.1).
 */
import type { Moment, Player } from "@sideline/engine";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BailoutQuestCard } from "../src/companion/cards/BailoutQuestCard.tsx";
import { BanterCard } from "../src/companion/cards/BanterCard.tsx";
import { RoomReadPods } from "../src/companion/cards/RoomReadPods.tsx";
import { SquadDiffLedger } from "../src/companion/cards/SquadDiffLedger.tsx";
import { TakeCard } from "../src/companion/cards/TakeCard.tsx";
import { renderCardPng } from "../src/share/cardImage.ts";
import { crowd, delivery, events, MATCH_ID, players } from "./helpers/match.ts";

afterEach(cleanup);

const byId = new Map<string, Player>(players.map((p) => [p.id, p]));
const base = {
  traceId: "trace-1",
  nudgeAt: null,
  provenance: "fallback" as const,
};
const xi = events.filter((e) => e.kind === "playing_xi").at(-1);
const XI_T = xi?.t ?? 0;

const lineup: Extract<Moment, { kind: "lineup_patch" }> = {
  ...base,
  id: "m-lineup",
  key: `lineup:${MATCH_ID}:cfff863e:none`,
  kind: "lineup_patch",
  phase: "toss_to_lock",
  createdAt: XI_T,
  revealAt: XI_T,
  scope: "session",
  payload: {
    notPlaying: [
      { playerId: "1777c020", team: "PAK" },
      { playerId: "919a3be2", team: "IND" },
    ],
    swaps: [
      { outId: "1777c020", inId: "6843a783", creditsAfter: 99, rationale: "Test rationale one." },
      { outId: "919a3be2", inId: "2e171977", creditsAfter: 98.5, rationale: "Test rationale two." },
    ],
    captain: { playerId: "8a75e999", rationale: "Test captain line." },
    viceCaptain: { playerId: "2f26ac1a", rationale: "Test vice-captain line." },
    conditionsRead: "Test conditions line.",
    squadValid: true,
    intent: null,
  },
};

describe("SquadDiffLedger (lineup patch)", () => {
  it("is held, with no names in it, until the fan's TV shows the XIs", () => {
    const { container } = render(
      <SquadDiffLedger
        moment={lineup}
        tvT={XI_T - 1}
        players={byId}
        locked={false}
        onIntent={() => {}}
      />,
    );
    expect(
      container.querySelector('[data-kind="lineup_patch"]')?.getAttribute("data-visibility"),
    ).toBe("hidden");
    expect(container.textContent).not.toMatch(/Fakhar|Shan Masood/);
  });

  it("shows each benched pick, the swap, the credits, the armbands and where the words came from", () => {
    render(
      <SquadDiffLedger
        moment={lineup}
        tvT={XI_T}
        players={byId}
        locked={false}
        onIntent={() => {}}
      />,
    );
    const rows = screen.getAllByRole("row");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringMatching(/Out.*In.*Credits after/),
      expect.stringMatching(/Fakhar Zaman.*Shan Masood.*99/),
      expect.stringMatching(/Rishabh Pant.*Axar Patel.*98\.5/),
    ]);
    expect(screen.getByText(/Captain: Babar Azam/)).toBeTruthy();
    expect(screen.getByText(/Vice-captain: Mohammad Rizwan/)).toBeTruthy();
    expect(screen.getByText("Your squad passes every rule after these swaps.")).toBeTruthy();
    expect(screen.getByText("Fallback: AI unavailable")).toBeTruthy();
  });

  it("sends the fan's request, and locks it once the first ball is on their TV", () => {
    const onIntent = vi.fn();
    const { rerender } = render(
      <SquadDiffLedger
        moment={lineup}
        tvT={XI_T}
        players={byId}
        locked={false}
        onIntent={onIntent}
      />,
    );
    fireEvent.change(screen.getByLabelText("Ask for a different patch"), {
      target: { value: "More bowling" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Patch again" }));
    expect(onIntent).toHaveBeenCalledWith("More bowling");
    rerender(
      <SquadDiffLedger moment={lineup} tvT={XI_T} players={byId} locked onIntent={onIntent} />,
    );
    expect((screen.getByLabelText("Ask for a different patch") as HTMLInputElement).disabled).toBe(
      true,
    );
    expect(screen.getByText("Teams locked at the first ball on your TV.")).toBeTruthy();
  });
});

const babarOut = delivery(1, "1.1");
const questWindow = { innings: 1 as const, fromLegalBall: 8, toLegalBall: 25 };
const bailout: Extract<Moment, { kind: "bailout" }> = {
  ...base,
  id: "m-bailout",
  key: `bailout:${MATCH_ID}:${babarOut.id}:C`,
  kind: "bailout",
  phase: "early_collapse",
  createdAt: babarOut.t,
  revealAt: babarOut.t,
  scope: "shared",
  payload: {
    trigger: {
      playerId: "8a75e999",
      role: "C",
      runs: 0,
      balls: 1,
      label: "1.1",
      eventId: babarOut.id,
    },
    projectedBefore: 718.64,
    projectedAfter: 606.92,
    quest: {
      title: "Comeback quest: 1.2 to 4.1",
      windowFromLabel: "1.2",
      windowToLabel: "4.1",
      predictions: [
        {
          id: "p1",
          prompt: "Another wicket?",
          options: [
            { id: "yes", label: "Yes" },
            { id: "no", label: "No" },
          ],
          rule: { type: "wicket_in_window", ...questWindow },
          rewardBucks: 100,
        },
        {
          id: "p2",
          prompt: "A six?",
          options: [
            { id: "yes", label: "Yes" },
            { id: "no", label: "No" },
          ],
          rule: { type: "boundary_in_window", ...questWindow, boundary: 6 },
          rewardBucks: 100,
        },
      ],
    },
    trivia: [
      {
        question: "How was Babar Azam out?",
        options: ["bowled", "caught", "lbw"],
        answerIndex: 2,
        fact: "Babar Azam lbw b Arshdeep Singh 0 (1)",
      },
    ],
    banter: {
      tone: "wholesome",
      headline: "Babar Azam out for 0",
      body: "Test banter body.",
      shareText: "Test share text.",
    },
  },
};
const upTo = (label: string) => events.filter((e) => e.seq <= delivery(1, label).seq);

describe("BailoutQuestCard (comeback quest)", () => {
  it("settles each prediction from the deliveries on the TV, and pays the fan's right calls", () => {
    // Raw file: Rizwan is caught at legal ball 24 (3.6); no six from ball 8 to 25.
    const { rerender } = render(
      <BailoutQuestCard
        moment={bailout}
        tvT={delivery(1, "3.1").t}
        players={byId}
        events={upTo("3.1")}
      />,
    );
    expect(screen.getByText(/Your captain Babar Azam is out for 0 \(1\) at 1\.1/)).toBeTruthy();
    expect(screen.getByText(/718\.6/)).toBeTruthy();
    const [wicket, six] = screen.getAllByRole("group");
    if (!wicket || !six) throw new Error("two predictions");
    expect(wicket.getAttribute("data-outcome")).toBe("pending");
    fireEvent.click(screen.getAllByRole("button", { name: "Yes" })[0] as HTMLElement);
    fireEvent.click(screen.getAllByRole("button", { name: "Yes" })[1] as HTMLElement);
    rerender(
      <BailoutQuestCard
        moment={bailout}
        tvT={delivery(1, "4.2").t}
        players={byId}
        events={upTo("4.2")}
      />,
    );
    expect(wicket.getAttribute("data-outcome")).toBe("won");
    expect(six.getAttribute("data-outcome")).toBe("lost");
    expect(wicket.textContent).toContain("You called it: +100 simulated DreamBucks");
    expect(six.textContent).toContain("Not this time");
    expect(screen.getByText("100 simulated DreamBucks won")).toBeTruthy();
  });

  it("answers its trivia with the fact it came from", () => {
    render(
      <BailoutQuestCard moment={bailout} tvT={babarOut.t} players={byId} events={upTo("1.1")} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "lbw" }));
    expect(screen.getByText(/Right\. Babar Azam lbw b Arshdeep Singh 0 \(1\)/)).toBeTruthy();
  });
});

describe("BanterCard and the shareable image", () => {
  it("shares the card's text when the browser cannot draw it", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    render(
      <BanterCard
        banter={bailout.payload.banter}
        share={{ share, canShare: () => false }}
        draw={async () => null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Share card" }));
    await vi.waitFor(() => expect(share).toHaveBeenCalledWith({ text: "Test share text." }));
  });

  it("draws the headline and body on a canvas and returns a PNG", async () => {
    const drawn: string[] = [];
    const ctx = new Proxy(
      {
        fillText: (text: string) => drawn.push(text),
        measureText: (text: string) => ({ width: text.length * 10 }),
      },
      // Every other drawing call is a no-op that hands back a gradient-shaped object.
      {
        get: (target, key) =>
          key in target ? target[key as keyof typeof target] : () => ({ addColorStop() {} }),
        set: () => true,
      },
    );
    const png = new Blob(["png"], { type: "image/png" });
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ctx,
      toBlob: (done: (b: Blob) => void) => done(png),
    };
    const blob = await renderCardPng(
      bailout.payload.banter,
      () => canvas as unknown as HTMLCanvasElement,
    );
    expect(blob).toBe(png);
    expect(drawn).toContain("Babar Azam out for 0");
    expect(drawn.join(" ")).toContain("Test banter body.");
  });
});

const end166 = delivery(2, "16.6");
const window = crowd.filter((m) => m.t > end166.t - 300_000 && m.t <= end166.t);
const [lineA, lineB, lineC] = window;
const room: Extract<Moment, { kind: "room_read" }> = {
  ...base,
  id: "m-room",
  key: `room:${MATCH_ID}:2:16`,
  kind: "room_read",
  phase: "climax",
  createdAt: end166.t,
  revealAt: end166.t,
  scope: "shared",
  payload: {
    windowFromT: end166.t - 300_000,
    windowToT: end166.t,
    messageCount: window.length,
    mood: { label: "Nervy", emoji: "😬" },
    pods: [
      {
        id: "pod-1",
        title: "Back the chase",
        stance: "Test stance one",
        sharePct: 55,
        sampleMessageIds: [lineA?.id ?? "", lineB?.id ?? ""],
      },
      {
        id: "pod-2",
        title: "Doubters",
        stance: "Test stance two",
        sharePct: 45,
        sampleMessageIds: [lineC?.id ?? ""],
      },
    ],
    hotTake: { messageId: lineA?.id ?? "", why: "Test why." },
    poll: {
      question: "16 off the last over?",
      options: [
        { id: "yes", label: "Yes" },
        { id: "no", label: "No" },
      ],
      rule: null,
    },
  },
};

describe("RoomReadPods (room read)", () => {
  it("shows each pod's share and its real lines from the chat, and the hot take", () => {
    render(<RoomReadPods moment={room} tvT={end166.t} chat={window} events={events} />);
    expect(screen.getByText("Back the chase")).toBeTruthy();
    expect(screen.getByText("55%")).toBeTruthy();
    expect(screen.getAllByText(lineB?.text ?? "never").length).toBeGreaterThan(0);
    expect(screen.getByText(/Test why\./)).toBeTruthy();
    expect(screen.getByText("Simulated crowd")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(screen.getByRole("button", { name: "Yes" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("is held until the over's last ball is on the TV", () => {
    const { container } = render(
      <RoomReadPods moment={room} tvT={end166.t - 1} chat={window} events={events} />,
    );
    expect(container.textContent).not.toContain("Back the chase");
  });
});

describe("TakeCard (stat-back)", () => {
  it("shows the verdict, the evidence and how Sideline checked it", () => {
    const take: Extract<Moment, { kind: "take_card" }> = {
      ...base,
      provenance: "live",
      id: "m-take",
      key: `statback:${MATCH_ID}:230:abcd1234`,
      kind: "take_card",
      phase: "any",
      createdAt: 0,
      revealAt: null,
      scope: "session",
      payload: {
        take: "Kohli is carrying this chase",
        verdict: "backed",
        statLine: "Test stat line.",
        sql: "SELECT sum(runs_batter) AS runs FROM visible_deliveries",
        rows: [{ runs: 61, balls: 47 }],
        confidence: "high",
      },
    };
    render(<TakeCard moment={take} />);
    expect(screen.getByText("Backed")).toBeTruthy();
    expect(screen.getByText("Test stat line.")).toBeTruthy();
    expect(screen.getByText("How Sideline checked")).toBeTruthy();
    expect(screen.getByText(/SELECT sum\(runs_batter\)/)).toBeTruthy();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "runs",
      "balls",
    ]);
    expect(screen.getByText("Live AI")).toBeTruthy();
  });
});
