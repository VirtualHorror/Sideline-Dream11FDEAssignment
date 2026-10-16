import { describe, expect, it } from "vitest";
import { buildTimeline, type DeliveryEvent, describeDelivery } from "../src/index.ts";
import { type FixtureMatchId, loadMatch } from "./helpers/data.ts";

const isDelivery = (event: { kind: string }): event is DeliveryEvent => event.kind === "delivery";

function fixture(id: FixtureMatchId) {
  const match = loadMatch(id);
  const deliveries = buildTimeline(match).filter(isDelivery);
  const players = new Map(match.players.players.map((player) => [player.id, player]));
  /** The delivery with this label (extras repeat labels: `extra` picks one, else the legal one). */
  const at = (innings: 1 | 2, label: string, extra?: "noballs" | "wides" | "byes") => {
    const found = deliveries.filter(
      (d) =>
        d.innings === innings &&
        d.label === label &&
        (extra ? d.extras[extra] > 0 : d.isLegal && d.extras.byes === 0),
    );
    const event = found.at(-1);
    if (!event) throw new Error(`no ${innings}:${label} ${extra ?? ""} in ${id}`);
    return event;
  };
  return { players, deliveries, at };
}

describe("describeDelivery (one-line commentary from the data)", () => {
  const { players, deliveries, at } = fixture("1298150");

  it("names the bowler and batter by their shortName in players.json (inn 2, 18.5)", () => {
    const event = at(2, "18.5");
    const { text, tags } = describeDelivery(event, players);
    expect(text).toContain(players.get(event.bowler)?.shortName ?? "missing bowler");
    expect(text).toContain(players.get(event.batter)?.shortName ?? "missing batter");
    expect(tags).toContain("six");
    expect(text).toBe("18.5 Rauf to Kohli, six");
  });

  it("tags the 19.4 no-ball, and the free hit on the wide that follows it", () => {
    const noBall = at(2, "19.4", "noballs");
    expect(describeDelivery(noBall, players).tags).toContain("noball");
    const next = deliveries[deliveries.indexOf(noBall) + 1];
    if (!next) throw new Error("no delivery after the no-ball");
    expect(describeDelivery(next, players).tags).toContain("freehit");
  });

  // Hand-derived from the raw Cricsheet final overs of the chase (and two first-innings balls).
  it.each([
    [2, "18.3", undefined, "18.3 Rauf to Hardik, no run", ["dot"]],
    [2, "19.1", undefined, "19.1 Nawaz to Hardik, OUT, caught by Babar", ["wicket"]],
    [2, "19.4", "noballs", "19.4 Nawaz to Kohli, no-ball, six", ["six", "noball"]],
    [2, "19.4", "wides", "19.4 Nawaz to Kohli, wide (free hit)", ["wide", "freehit"]],
    [2, "19.4", "byes", "19.4 Nawaz to Kohli, 3 byes (free hit)", ["freehit", "byes"]],
    [2, "19.5", undefined, "19.5 Nawaz to Karthik, OUT, stumped by Rizwan", ["wicket"]],
    [2, "19.6", "wides", "19.6 Nawaz to Ashwin, wide", ["wide"]],
    [2, "19.6", undefined, "19.6 Nawaz to Ashwin, 1 run", ["single"]],
    [2, "0.6", undefined, "0.6 Shaheen to Rohit, 2 runs", []],
    [2, "6.1", undefined, "6.1 Shadab to Axar, OUT, run out by Rizwan and Babar", ["wicket"]],
    [1, "1.1", undefined, "1.1 Arshdeep to Babar, OUT, lbw", ["wicket"]],
    [1, "1.6", undefined, "1.6 Arshdeep to Rizwan, four", ["four"]],
    [1, "7.2", undefined, "7.2 Shami to Iftikhar, 1 leg bye", ["byes"]],
  ] as const)("describes inn %i %s %s as %j", (innings, label, extra, text, tags) => {
    expect(describeDelivery(at(innings, label, extra), players)).toEqual({ text, tags });
  });

  it("names the batter who is out when it is the non-striker, and skips retired hurt as a wicket", () => {
    const ball = at(2, "18.3");
    const runOut: DeliveryEvent = {
      ...ball,
      wickets: [
        {
          kind: "run out",
          playerOut: ball.nonStriker,
          fielders: [ball.bowler],
          creditedToBowler: false,
        },
      ],
    };
    expect(describeDelivery(runOut, players)).toEqual({
      text: "18.3 Rauf to Hardik, no run, Kohli run out by Rauf",
      tags: ["wicket"],
    });
    const retired: DeliveryEvent = {
      ...ball,
      wickets: [
        { kind: "retired hurt", playerOut: ball.batter, fielders: [], creditedToBowler: false },
      ],
    };
    expect(describeDelivery(retired, players)).toEqual({
      text: "18.3 Rauf to Hardik, no run, Hardik retired hurt",
      tags: ["dot"],
    });
  });

  it("works on the second match too (1415755, Klaasen's dismissal at 16.1)", () => {
    const final = fixture("1415755");
    expect(describeDelivery(final.at(2, "16.1"), final.players)).toEqual({
      text: "16.1 Hardik to Klaasen, OUT, caught by Pant",
      tags: ["wicket"],
    });
  });
});
