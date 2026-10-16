import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type ArchiveRaw, filterReason, runEngine, synthesizeFixtures } from "../lib/archive.ts";

const REPO = join(import.meta.dirname, "..", "..");
// The archive is never shipped; these cases mutate a copy of a committed real match instead.
const demo = (): ArchiveRaw =>
  JSON.parse(readFileSync(join(REPO, "data", "raw", "cricsheet", "1298150.json"), "utf8"));

function withInfo(change: (info: ArchiveRaw["info"]) => void): ArchiveRaw {
  const raw = demo();
  change(raw.info);
  return raw;
}

describe("filterReason (PLAN Task 3 build filters)", () => {
  it("keeps a decided 20-over men's T20I with a 20-over chase target", () => {
    expect(filterReason(demo())).toBeNull();
    expect(filterReason(withInfo((info) => (info.outcome = { result: "tie" })))).toBeNull();
  });

  it.each([
    ["a women's match", withInfo((info) => (info.gender = "female")), "not a men's T20"],
    ["a 50-over match", withInfo((info) => (info.overs = 50)), "not 20 overs a side"],
    [
      "a no result",
      withInfo((info) => (info.outcome = { result: "no result" })),
      "no winner and not a tie",
    ],
    [
      "a DLS result",
      withInfo((info) => (info.outcome = { winner: "India", by: { runs: 3 }, method: "D/L" })),
      "result decided by a method (DLS, VJD, awarded)",
    ],
  ])("excludes %s", (_name, raw, reason) => {
    expect(filterReason(raw)).toBe(reason);
  });

  it("excludes matches without exactly two innings, including super overs", () => {
    const oneInnings = demo();
    oneInnings.innings = oneInnings.innings.slice(0, 1);
    expect(filterReason(oneInnings)).toBe("not exactly two innings (no result, super over)");
    const superOver = demo();
    const extra = superOver.innings[0];
    if (!extra) throw new Error("fixture has no innings");
    superOver.innings.push({ ...extra, super_over: true }, { ...extra, super_over: true });
    expect(filterReason(superOver)).toBe("not exactly two innings (no result, super over)");
  });

  it("excludes a chase whose target is missing or not over 20 overs", () => {
    const shortened = demo();
    const chase = shortened.innings[1];
    if (!chase?.target) throw new Error("fixture has no target");
    chase.target = { ...chase.target, overs: 18 };
    expect(filterReason(shortened)).toBe("chase target missing or not 20 overs");
    delete chase.target;
    expect(filterReason(shortened)).toBe("chase target missing or not 20 overs");
  });
});

describe("synthesizeFixtures", () => {
  it("builds schema-valid fixtures from the raw XIs with placeholder codes and BAT roles", () => {
    const raw = demo();
    const { players, context } = synthesizeFixtures("1298150", raw, (id) =>
      id === "ba607b88" ? "AR" : undefined,
    );
    expect(context.teams.map((team) => [team.code, team.name, team.cricsheetName])).toEqual([
      ["TA", "Pakistan", "Pakistan"],
      ["TB", "India", "India"],
    ]);
    expect(context.notes).toEqual([]);
    expect(players.players).toHaveLength(22);
    expect(players.players[0]).toEqual({
      id: "2f26ac1a",
      cricsheetName: "Mohammad Rizwan",
      displayName: "Mohammad Rizwan",
      shortName: "Mohammad Rizwan",
      team: "TA",
      role: "BAT",
      credits: 8,
    });
    expect(players.players.find((player) => player.id === "ba607b88")?.role).toBe("AR");
    expect(new Set(players.players.map((player) => player.role))).toEqual(new Set(["BAT", "AR"]));
  });
});

describe("runEngine (BUG-002 rejection accounting)", () => {
  it("accepts a supported match and returns its events and final state", () => {
    const run = runEngine("1298150", demo());
    if (!run.ok) throw new Error(`unexpected rejection: ${run.reason}`);
    expect(run.events.at(-1)?.kind).toBe("match_end");
    expect(run.state.result?.winner).toBe("TB");
    expect(run.players.players).toHaveLength(22);
  });

  const deliveryAt = (raw: ArchiveRaw, innings: number, over: number, index: number) => {
    const delivery = raw.innings[innings]?.overs[over]?.deliveries[index];
    if (!delivery) throw new Error("fixture delivery missing");
    return delivery;
  };

  it.each([
    [
      "a bowler changed mid-over",
      (raw: ArchiveRaw) => {
        const other = deliveryAt(raw, 0, 3, 0).bowler;
        deliveryAt(raw, 0, 2, 3).bowler = other;
      },
      "bowler changed mid-over",
    ],
    [
      "an over with a seventh legal ball",
      (raw: ArchiveRaw) => {
        const over = raw.innings[0]?.overs[0];
        const legal = over?.deliveries.find(
          (delivery) => !delivery.extras?.wides && !delivery.extras?.noballs,
        );
        if (!over || !legal) throw new Error("fixture over missing");
        over.deliveries.push(structuredClone(legal));
      },
      "an over with more than six legal balls",
    ],
    [
      "a 12-player XI",
      (raw: ArchiveRaw) => raw.info.players.Pakistan?.push("M Erasmus"),
      "a team lists more than 11 players",
    ],
    [
      "a 10-player XI",
      (raw: ArchiveRaw) => raw.info.players.Pakistan?.pop(),
      "a team lists fewer than 11 players",
    ],
    [
      "a nameless fielder",
      (raw: ArchiveRaw) => {
        const wicket = deliveryAt(raw, 0, 3, 5).wickets?.[0];
        if (!wicket?.fielders?.[0]) throw new Error("fixture catch missing");
        wicket.fielders[0] = {};
      },
      "a fielder entry without a name",
    ],
    [
      "a retired-not-out dismissal",
      (raw: ArchiveRaw) => {
        const wicket = deliveryAt(raw, 0, 3, 5).wickets?.[0];
        if (!wicket) throw new Error("fixture wicket missing");
        wicket.kind = "retired not out";
      },
      "wicket kind retired not out",
    ],
  ])("rejects %s with a named reason", (_name, mutate, reason) => {
    const raw = demo();
    mutate(raw);
    expect(runEngine("1298150", raw)).toEqual({ ok: false, reason });
  });

  it("never drops an unclassified failure silently: the stage and message become the reason", () => {
    const raw = demo();
    deliveryAt(raw, 0, 0, 0).batter = "An Unregistered Name";
    const run = runEngine("1298150", raw);
    expect(run.ok).toBe(false);
    expect(run.ok ? "" : run.reason).toMatch(/^timeline: .*registry/);
  });
});
