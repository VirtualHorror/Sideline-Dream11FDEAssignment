import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildTimeline,
  MatchContextFileSchema,
  PlayersFileSchema,
  simulateCrowd,
} from "@sideline/engine";
import { describe, expect, it } from "vitest";
import { loadMatchBundles, validateJoinPoints } from "../src/data/bundle.ts";

const DATA = join(import.meta.dirname, "..", "..", "..", "data");
const readJson = (...parts: string[]): unknown =>
  JSON.parse(readFileSync(join(DATA, ...parts), "utf8"));

describe("loadMatchBundles (PLAN 5.1)", () => {
  const bundles = loadMatchBundles(DATA);

  it("loads and validates both manifest matches", () => {
    expect([...bundles.keys()]).toEqual(["1298150", "1415755"]);
    const pak = bundles.get("1298150");
    expect(pak?.summary).toMatchObject({
      id: "1298150",
      date: "2022-10-23",
      venue: "Melbourne Cricket Ground",
    });
    expect(pak?.personas.map((p) => p.id)).toEqual([
      "babar-believer",
      "late-from-work",
      "f1-convert",
    ]);
    expect(pak?.players).toHaveLength(30);
    expect(bundles.get("1415755")?.summary).toMatchObject({ id: "1415755", date: "2024-06-29" });
    for (const bundle of bundles.values()) {
      expect(bundle.priors.matchId).toBe(bundle.summary.id);
      expect(bundle.winprob.leverage.nudgeThreshold).toBeGreaterThan(0);
      expect(bundle.corpus.lines.length).toBeGreaterThanOrEqual(240);
    }
  });

  it.each(["1298150", "1415755"])("%s: events equal buildTimeline on the raw file", (id) => {
    const expected = buildTimeline({
      raw: readJson("raw", "cricsheet", `${id}.json`),
      players: PlayersFileSchema.parse(readJson("matches", id, "players.json")),
      context: MatchContextFileSchema.parse(readJson("matches", id, "context.json")),
    });
    expect(bundles.get(id)?.events).toEqual(expected);
  });

  // D-050 (Nabhanyu): one synthetic crowd per match, seeded with the match id, shared by everyone.
  it.each(["1298150", "1415755"])("%s: holds the match's one shared crowd", (id) => {
    const bundle = bundles.get(id);
    if (!bundle) throw new Error(`no bundle ${id}`);
    const expected = simulateCrowd({
      events: bundle.events,
      players: bundle.players,
      corpus: bundle.corpus,
      seed: id,
    });
    expect(bundle.crowd).toEqual(expected);
    expect(bundle.crowd.length).toBeGreaterThan(100);
    expect(bundle.crowd.every((m) => m.synthetic && !m.fromYou)).toBe(true);
    expect(loadMatchBundles(DATA).get(id)?.crowd).toEqual(bundle.crowd);
  });
});

describe("loadMatchBundles rejects broken data at boot", () => {
  function copyData(): string {
    const dir = mkdtempSync(join(tmpdir(), "sideline-bundle-"));
    cpSync(DATA, dir, { recursive: true, filter: (src) => !src.includes("runtime") });
    return dir;
  }

  it("names the file that fails its schema", () => {
    const dir = copyData();
    const path = join(dir, "matches", "1415755", "personas.json");
    const personas = JSON.parse(readFileSync(path, "utf8"));
    personas.personas[0].delayMs = -5;
    writeFileSync(path, JSON.stringify(personas));
    expect(() => loadMatchBundles(dir)).toThrow(/1415755.*personas\.json/);
  });

  // Both demo chases ran all 20 overs, so every schema-valid join point exists in the real data; a
  // timeline cut after the chase's 10th over shows the check: late-from-work joins after 14 overs.
  it("refuses a persona whose join point the timeline never reaches", () => {
    const bundle = bundles1298150();
    const cut = bundle.events.filter(
      (e) => !(e.kind === "delivery" && e.innings === 2 && e.over >= 10),
    );
    expect(() => validateJoinPoints("1298150", bundle.events, bundle.personas)).not.toThrow();
    expect(() => validateJoinPoints("1298150", cut, bundle.personas)).toThrow(
      /1298150.*late-from-work.*innings 2 never reached 14 overs/,
    );
  });
});

function bundles1298150() {
  const bundle = loadMatchBundles(DATA).get("1298150");
  if (!bundle) throw new Error("no bundle 1298150");
  return bundle;
}
