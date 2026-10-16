import { describe, expect, it } from "vitest";
import { type FantasyRules, type Player, validateSquad } from "../src/index.ts";

// Hand-built pool: 11 players for team "AAA", 11 for "BBB". Ids are 8-hex like the
// Cricsheet registry. Credits chosen so the base squad below totals exactly 99.0.
const p = (id: string, team: string, role: Player["role"], credits: number): Player => ({
  id,
  cricsheetName: id,
  displayName: id,
  shortName: id,
  team,
  role,
  credits,
});

const pool: Player[] = [
  p("a0000001", "AAA", "WK", 9),
  p("a0000002", "AAA", "BAT", 10),
  p("a0000003", "AAA", "BAT", 9.5),
  p("a0000004", "AAA", "AR", 9),
  p("a0000005", "AAA", "BOWL", 8.5),
  p("a0000006", "AAA", "BOWL", 8.5),
  p("a0000007", "AAA", "BOWL", 8),
  p("a0000008", "AAA", "BAT", 8),
  p("a0000009", "AAA", "BOWL", 7.5),
  p("a000000a", "AAA", "BOWL", 7.5),
  p("a000000b", "AAA", "WK", 8),
  p("b0000001", "BBB", "BAT", 10),
  p("b0000002", "BBB", "BAT", 9),
  p("b0000003", "BBB", "AR", 8.5),
  p("b0000004", "BBB", "BOWL", 9),
  p("b0000005", "BBB", "BOWL", 8),
  p("b0000006", "BBB", "BAT", 10.5),
  p("b0000007", "BBB", "WK", 8.5),
  p("b0000008", "BBB", "BOWL", 7.5),
  p("b0000009", "BBB", "AR", 8),
  p("b000000a", "BBB", "BOWL", 7),
  p("b000000b", "BBB", "BAT", 7.5),
];

const team: FantasyRules["team"] = {
  size: 11,
  credits: 100,
  maxFromOneTeam: 7,
  roles: { WK: [1, 4], BAT: [3, 6], AR: [1, 4], BOWL: [3, 6] },
  captainMultiplier: 2,
  viceCaptainMultiplier: 1.5,
};

// 1 WK, 4 BAT, 2 AR, 4 BOWL; 6 from AAA, 5 from BBB.
// Credits: 9 + 10 + 9.5 + 9 + 8.5 + 8.5 (AAA = 54.5) + 10 + 9 + 8.5 + 9 + 8 (BBB = 44.5) = 99.0
const baseIds = [
  "a0000001",
  "a0000002",
  "a0000003",
  "a0000004",
  "a0000005",
  "a0000006",
  "b0000001",
  "b0000002",
  "b0000003",
  "b0000004",
  "b0000005",
];
const base = { playerIds: baseIds, captainId: "a0000002", viceCaptainId: "b0000001" };
const codes = (ids: string[]) =>
  validateSquad({ ...base, playerIds: ids }, pool, team).issues.map((i) => i.code);

describe("validateSquad", () => {
  it("accepts a legal squad and reports its credits and composition", () => {
    const result = validateSquad(base, pool, team);
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.credits).toBe(99);
    expect(result.roleCounts).toEqual({ WK: 1, BAT: 4, AR: 2, BOWL: 4 });
    expect(result.teamCounts).toEqual({ AAA: 6, BBB: 5 });
  });

  it("flags a squad over the credit budget", () => {
    // Swap b0000005 (8.0) for b0000006 (10.5): 99 - 8 + 10.5 = 101.5 > 100; BAT becomes 5, BOWL 3.
    const ids = baseIds.map((id) => (id === "b0000005" ? "b0000006" : id));
    const result = validateSquad({ ...base, playerIds: ids }, pool, team);
    expect(result.valid).toBe(false);
    expect(result.credits).toBe(101.5);
    expect(result.issues.map((i) => i.code)).toEqual(["credits"]);
  });

  it("flags more than the allowed players from one real team", () => {
    // Replace two BBB players with AAA bowlers: AAA = 8 > 7. Credits 99 - 9 - 8 + 7.5 + 7.5 = 97.
    const ids = baseIds.map((id) =>
      id === "b0000004" ? "a0000009" : id === "b0000005" ? "a000000a" : id,
    );
    expect(codes(ids)).toEqual(["team_max"]);
  });

  it("flags a squad without a wicket-keeper", () => {
    // a0000001 (WK) -> a0000008 (BAT): WK 0, BAT 5.
    const ids = baseIds.map((id) => (id === "a0000001" ? "a0000008" : id));
    expect(codes(ids)).toEqual(["role_min"]);
  });

  it("flags too many bowlers", () => {
    // Two batters out, two bowlers in: BAT 2 (< 3) and BOWL 6 (ok) -> role_min for BAT only.
    // Then a third: BAT 1, BOWL 7 -> role_min (BAT) and role_max (BOWL).
    const ids = baseIds.map((id) =>
      id === "a0000003"
        ? "a0000007"
        : id === "b0000002"
          ? "b0000008"
          : id === "a0000002"
            ? "a0000009"
            : id,
    );
    const result = validateSquad({ ...base, playerIds: ids, captainId: "a0000004" }, pool, team);
    expect(result.roleCounts.BOWL).toBe(7);
    expect(result.issues.map((i) => i.code).sort()).toEqual(["role_max", "role_min"]);
  });

  it("flags unknown, duplicated and missing players", () => {
    expect(codes([...baseIds.slice(0, 10), "ffffffff"])).toContain("unknown_player");
    expect(codes([...baseIds.slice(0, 10), baseIds[0] as string])).toContain("duplicate");
    expect(codes(baseIds.slice(0, 10))).toContain("size");
  });

  it("flags a captain or vice-captain outside the squad", () => {
    const outsideCaptain = validateSquad({ ...base, captainId: "b000000b" }, pool, team);
    expect(outsideCaptain.issues.map((i) => i.code)).toEqual(["captain"]);
    const sameAsCaptain = validateSquad({ ...base, viceCaptainId: base.captainId }, pool, team);
    expect(sameAsCaptain.issues.map((i) => i.code)).toEqual(["vice_captain"]);
  });
});
