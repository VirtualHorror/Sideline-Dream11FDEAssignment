import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { applyEvent, buildTimeline, createMatchState, foldEvents } from "../src/index.ts";
import { loadMatch, MATCH_IDS } from "./helpers/data.ts";

describe.each(MATCH_IDS)("fold property for match %s", (matchId) => {
  it("equals an explicit step-by-step replay for every sampled sequence endpoint", () => {
    const fixture = loadMatch(matchId);
    const events = buildTimeline(fixture);
    fc.assert(
      fc.property(fc.integer({ min: -1, max: events.length - 1 }), (uptoSeq) => {
        const stepped = createMatchState(matchId);
        for (const event of events) {
          if (event.seq > uptoSeq) break;
          applyEvent(stepped, event);
        }
        expect(foldEvents(matchId, events, uptoSeq)).toEqual(stepped);
      }),
      { numRuns: 80 },
    );
  });
});
