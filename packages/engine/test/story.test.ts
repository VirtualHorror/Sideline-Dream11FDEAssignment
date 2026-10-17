/**
 * PLAN 9.3, the guided story's beats: derived from the personas (the story fan is the first pre-match
 * persona with a team, the catch-up point the first late joiner's) and from the gate's own triggers on
 * the timeline, never from labels. Expected beats: DOMAIN §4 and PLAN 4.4 (Babar out at 1.1, Rohit at
 * 1.4), F04's teaser and room lists (the first death-over teasers of the chases: 18.6 of 2022, 16.1 of
 * 2024), the personas' join points.
 */
import { describe, expect, it } from "vitest";
import {
  buildStoryPlan,
  type MatchEvent,
  type Persona,
  StoryPlanSchema,
  simulateCrowd,
} from "../src/index.ts";
import {
  type FixtureMatchId,
  loadCorpus,
  loadMatch,
  loadPriors,
  loadWinProbModel,
} from "./helpers/data.ts";
import { timelineOf } from "./helpers/replay.ts";

function planFor(id: FixtureMatchId, personas?: Persona[]) {
  const match = loadMatch(id);
  const events = timelineOf(id);
  return buildStoryPlan({
    matchId: id,
    events,
    players: match.players.players,
    rules: match.rules,
    personas: personas ?? match.personas.personas,
    winprob: loadWinProbModel(),
    priors: loadPriors(id),
    chat: simulateCrowd({ events, players: match.players.players, corpus: loadCorpus(), seed: id }),
  });
}

const deliveryAt = (events: readonly MatchEvent[], innings: 1 | 2, label: string) => {
  const found = events.find(
    (e) => e.kind === "delivery" && e.innings === innings && e.label === label && e.isLegal,
  );
  if (!found) throw new Error(`no ${innings}:${label}`);
  return found;
};
/** The delivery just before `event` in the timeline. */
const previousDelivery = (events: readonly MatchEvent[], event: MatchEvent) =>
  events.filter((e) => e.kind === "delivery" && e.seq < event.seq).at(-1);

describe("buildStoryPlan (PLAN 9.3)", () => {
  it.each([
    [
      "1298150",
      "babar-believer",
      { innings: 2, afterOvers: 14 },
      "Late from work",
      ["1", "1.1"],
      ["2", "18.6"],
      18,
    ],
    [
      "1415755",
      "captain-rohit",
      { innings: 2, afterOvers: 15 },
      "Proteas fan, joining late",
      ["1", "1.4"],
      ["2", "16.1"],
      16,
    ],
  ] as const)(
    "%s: lineup, bailout, catch-up, climax, room read and result, from the data",
    (id, personaId, joinAt, lateLabel, [bInnings, bLabel], [cInnings, cLabel], roomOver) => {
      const events = timelineOf(id);
      const plan = StoryPlanSchema.parse(planFor(id));
      expect(plan).toMatchObject({ matchId: id, personaId });
      expect(plan.beats.map((b) => b.kind)).toEqual([
        "lineup",
        "bailout",
        "catch_up",
        "climax",
        "room_read",
        "result",
      ]);
      const [lineup, bailout, catchUp, climax, room, result] = plan.beats;
      const xi = events.filter((e) => e.kind === "playing_xi").at(-1);
      expect(lineup).toMatchObject({ jump: { kind: "toss" }, eventId: xi?.id, t: xi?.t });
      const wicket = deliveryAt(events, Number(bInnings) as 1 | 2, bLabel);
      // Two deliveries ahead of the wicket, so the fan sees it bowled.
      const leadIn = previousDelivery(events, previousDelivery(events, wicket) as MatchEvent);
      expect(bailout).toMatchObject({
        eventId: wicket.id,
        t: wicket.t,
        jump: { kind: "event", eventId: leadIn?.id },
      });
      expect(bailout?.kind === "bailout" && bailout.key).toMatch(/^bailout:/);
      expect(catchUp).toMatchObject({ jump: { kind: "over", ...joinAt }, personaLabel: lateLabel });
      const ball = deliveryAt(events, Number(cInnings) as 1 | 2, cLabel);
      expect(climax).toMatchObject({
        eventId: ball.id,
        key: `nudge:${id}:${ball.id}`,
        jump: { kind: "event", eventId: previousDelivery(events, ball)?.id },
      });
      expect(room?.kind === "room_read" && room.key).toBe(`room:${id}:2:${roomOver}`);
      expect(result).toMatchObject({ eventId: events.at(-1)?.id, t: events.at(-1)?.t });
      expect(events.at(-1)?.kind).toBe("match_end");
    },
  );

  it("follows the triggers: a different captain moves the bailout to his own dismissal", () => {
    const match = loadMatch("1298150");
    const [babarFan, ...rest] = match.personas.personas;
    if (!babarFan?.squad) throw new Error("babar-believer has a team");
    // Rizwan (vice-captain) as captain, Babar off the armbands: Rizwan, caught at legal ball 24 of the
    // innings with 4 runs (the raw file), is the cheap early dismissal now.
    const rizwanFan: Persona = {
      ...babarFan,
      squad: { ...babarFan.squad, captainId: "2f26ac1a", viceCaptainId: "9de62878" },
    };
    const plan = planFor("1298150", [rizwanFan, ...rest]);
    const bailout = plan?.beats.find((b) => b.kind === "bailout");
    const events = timelineOf("1298150");
    const wicket = events.find(
      (e) => e.kind === "delivery" && e.wickets.some((w) => w.playerOut === "2f26ac1a"),
    );
    expect(bailout).toMatchObject({ eventId: wicket?.id });
    expect(bailout?.kind === "bailout" && bailout.key).toBe(`bailout:1298150:${wicket?.id}:C`);
  });

  it("has no story without a pre-match fan with a team, and no catch-up beat without a late joiner", () => {
    const personas = loadMatch("1298150").personas.personas;
    expect(
      planFor(
        "1298150",
        personas.filter((p) => p.joinAt.kind !== "pre_match"),
      ),
    ).toBeNull();
    const plan = planFor(
      "1298150",
      personas.filter((p) => p.joinAt.kind === "pre_match"),
    );
    expect(plan?.beats.map((b) => b.kind)).toEqual([
      "lineup",
      "bailout",
      "climax",
      "room_read",
      "result",
    ]);
  });
});
