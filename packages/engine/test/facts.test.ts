import { describe, expect, it } from "vitest";
import { foldEvents, joinSeq, situationOf } from "../src/index.ts";
import { personaOf, timelineOf } from "./helpers/replay.ts";

// Task 5 exports situationOf so the server can say where the match stands on a fan's TV (the
// explainer's facts). Expected values are DOMAIN §4's, read from the raw scorecards.
describe("situationOf (public from Task 5)", () => {
  it.each([
    [
      "1298150",
      "late-from-work",
      { score: "90/4", target: 160, runsRequired: 70, ballsRemaining: 36, rrr: 11.67 },
    ],
    [
      "1415755",
      "proteas-late",
      { score: "147/4", target: 177, runsRequired: 30, ballsRemaining: 30, rrr: 6 },
    ],
  ] as const)("%s %s: the chase at the join point", (id, personaId, expected) => {
    const events = timelineOf(id);
    const state = foldEvents(id, events, joinSeq(events, personaOf(id, personaId).joinAt));
    expect(situationOf(state)).toMatchObject({ innings: 2, ...expected });
  });

  it("is null before the first innings starts", () => {
    expect(situationOf(foldEvents("1298150", timelineOf("1298150"), -1))).toBeNull();
  });
});
