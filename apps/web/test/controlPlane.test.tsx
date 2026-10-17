import type { AICallTrace, GateDecision, Moment, TelemetrySnapshot } from "@sideline/engine";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { ControlPlaneDrawer } from "../src/controlplane/ControlPlaneDrawer.tsx";
import { delivery, events, MATCH_ID } from "./helpers/match.ts";

afterEach(cleanup);

const quiet = delivery(2, "18.5");
const big = delivery(2, "18.6");
const key = `nudge:${MATCH_ID}:${big.id}`;

const decisions: GateDecision[] = [
  {
    eventId: quiet.id,
    t: quiet.t,
    detector: "nudge",
    outcome: "deterministic",
    reason: "below_threshold",
    momentKey: null,
    costMicros: 35,
  },
  {
    eventId: big.id,
    t: big.t,
    detector: "nudge",
    outcome: "ai_trigger",
    reason: "big_ball",
    momentKey: key,
    costMicros: 41,
  },
];

// A trace shaped like the gateway's: a guard rejection whose detail quotes the score after the ball.
const trace: AICallTrace = {
  id: "trace-18.6",
  skill: "spoiler_nudge",
  momentKey: key,
  provider: "openai",
  model: "gpt-6.1-sol",
  cache: "miss",
  outcome: "fallback",
  latencyMs: 5200,
  tokensIn: 4512,
  tokensOut: 38,
  costUsd: 0.0233,
  costEstimated: true,
  promptVersion: "teaser-v1",
  startedAtWall: "2026-10-17T12:00:00.000Z",
  budgetMs: 9000,
  detail: "guard: the score after the ball (144/4)",
};

const telemetry: TelemetrySnapshot = {
  scope: "session",
  counters: {
    eventsTotal: 6,
    eventsDeterministic: 5,
    gateTriggers: 2,
    aiCallsLive: 1,
    aiCacheHits: 0,
    aiFallbacks: 1,
    tokensIn: 4512,
    tokensOut: 38,
    costUsd: 0.0233,
  },
  latencyMs: { p50: 5200, p95: 5200 },
  recentDecisions: decisions,
  recentCalls: [trace],
  projection: {
    concurrentViewers: 10_000_000,
    eventsPerMatch: 266,
    naiveLlmCalls: 2_660_000_000,
    sidelineLlmCalls: 4,
    savedPct: 99.99999984962406,
    formula:
      "naive = 266 events × 10,000,000 viewers = 2,660,000,000 calls; Sideline = 4 shared moment keys + 0.00 personal moments per viewer × 10,000,000 viewers = 4 calls; saved = 1 − 4 / 2,660,000,000 = 99.9999998%",
  },
};

const moment: Moment = {
  id: "moment-18.6",
  key,
  kind: "spoiler_nudge",
  phase: "climax",
  createdAt: big.t,
  revealAt: big.t,
  nudgeAt: big.t - 6000,
  provenance: "fallback",
  traceId: trace.id,
  scope: "shared",
  payload: {
    eventId: big.id,
    nudge: "India need 22 off 7. Kohli (68 off 49) faces Rauf.",
    reveal: "18.6 Rauf to Kohli, six. India 144/4, need 16 off 6",
    leverage: 0.41,
    budgetMs: 9000,
    usedMs: 5200,
  },
};

const drawer = (tvT: number) => (
  <ControlPlaneDrawer
    telemetry={telemetry}
    tvT={tvT}
    events={events}
    moments={[moment]}
    defaultOpen
  />
);

describe("control plane (PLAN 6.5)", () => {
  it("shows counters, decisions with reasons, traces with provenance and JSON, and the projection", async () => {
    const user = userEvent.setup();
    render(drawer(big.t + 1));
    const counters = screen.getByRole("region", { name: "Counters" });
    expect(within(counters).getByText("Handled without AI").nextSibling?.textContent).toBe(
      "5 of 6 (83%)",
    );
    expect(within(counters).getByText("Cost").nextSibling?.textContent).toBe("$0.0233 est.");

    const log = screen.getByRole("table", { name: "Gate decisions" });
    expect(within(log).getByText("below_threshold")).toBeTruthy();
    expect(within(log).getByText("big_ball")).toBeTruthy();
    expect(within(log).getByText("18.6")).toBeTruthy();

    const traces = screen.getByRole("list", { name: "AI calls" });
    expect(within(traces).getByText("Fallback: AI unavailable")).toBeTruthy();
    expect(within(traces).getByText("guard: the score after the ball (144/4)")).toBeTruthy();
    await user.click(within(traces).getByRole("button", { name: /show the json/i }));
    const json = within(traces).getByLabelText("Trace JSON");
    expect(JSON.parse(json.textContent ?? "{}")).toMatchObject({
      trace: { id: "trace-18.6", skill: "spoiler_nudge", budgetMs: 9000 },
      payload: { eventId: big.id },
    });

    expect(screen.getByText(telemetry.projection.formula)).toBeTruthy();
  });

  it("holds every row about a ball the fan's TV has not shown yet", () => {
    const { container } = render(drawer(big.t - 20_000));
    const log = screen.getByRole("table", { name: "Gate decisions" });
    expect(within(log).queryByText("big_ball")).toBeNull();
    expect(within(log).getByText("below_threshold")).toBeTruthy();
    const traces = screen.getByRole("list", { name: "AI calls" });
    expect(within(traces).getByText("Held until your TV shows this moment")).toBeTruthy();
    expect(container.innerHTML).not.toContain("144/4");
    expect(within(traces).queryByRole("button", { name: /show the json/i })).toBeNull();
  });

  it("summarises itself in one line while collapsed", async () => {
    const user = userEvent.setup();
    render(<ControlPlaneDrawer telemetry={telemetry} tvT={big.t} events={events} moments={[]} />);
    const toggle = screen.getByRole("button", { name: /control plane/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toContain("5 of 6 handled without AI");
    expect(screen.queryByRole("table", { name: "Gate decisions" })).toBeNull();
    await user.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("table", { name: "Gate decisions" })).toBeTruthy();
  });
});
