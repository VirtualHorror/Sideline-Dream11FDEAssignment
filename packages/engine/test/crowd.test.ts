import { describe, expect, it } from "vitest";
import {
  buildTimeline,
  CHAT_PLACEHOLDERS,
  ChatMessageSchema,
  CROWD_TRIGGERS,
  type DeliveryEvent,
  mulberry32,
  seedFrom,
  simulateCrowd,
} from "../src/index.ts";
import { loadCorpus, loadMatch, MATCH_IDS } from "./helpers/data.ts";

describe("seeded randomness (util/prng)", () => {
  // Reference values from an independent Python port of mulberry32 (F04 log).
  it.each([
    [1, [0.6270739405881613, 0.002735721180215478, 0.5274470399599522]],
    [42, [0.6011037519201636, 0.44829055899754167, 0.8524657934904099]],
  ] as const)("mulberry32(%i) starts with the reference sequence", (seed, expected) => {
    const random = mulberry32(seed);
    expect([random(), random(), random()]).toEqual(expected);
  });

  it("derives a seed from text with FNV-1a ('abc' is the standard test vector 0x1a47e90b)", () => {
    expect(seedFrom("abc")).toBe(440_920_331);
    expect(seedFrom("session-a")).toBe(2_741_673_309);
    expect(seedFrom("session-a")).not.toBe(seedFrom("session-b"));
  });
});

function simulate(id: (typeof MATCH_IDS)[number], seed: string) {
  const match = loadMatch(id);
  const events = buildTimeline(match);
  const messages = simulateCrowd({
    events,
    players: match.players.players,
    corpus: loadCorpus(),
    seed,
  });
  return { events, messages };
}

describe.each(MATCH_IDS)("simulated crowd for %s", (id) => {
  it("is reproducible from its seed and changes with it", () => {
    const first = simulate(id, "session-a").messages;
    expect(simulate(id, "session-a").messages).toEqual(first);
    const other = simulate(id, "session-b").messages;
    expect(other.map((m) => m.text)).not.toEqual(first.map((m) => m.text));
  });

  it("produces valid, labelled synthetic messages with every placeholder filled", () => {
    const { messages } = simulate(id, "session-a");
    expect(messages.length).toBeGreaterThan(200);
    for (const message of messages) {
      expect(ChatMessageSchema.safeParse(message).success).toBe(true);
      expect(message).toMatchObject({ synthetic: true, fromYou: false });
      expect(message.text).not.toMatch(/[{}]/);
    }
    const ids = messages.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    const stamps = messages.map((m) => m.t);
    expect(stamps).toEqual([...stamps].sort((a, b) => a - b));
  });

  it("bursts right after wickets: at least 3x the match-wide rate per 10 s", () => {
    const { events, messages } = simulate(id, "session-a");
    const wickets = events.filter(
      (e): e is DeliveryEvent =>
        e.kind === "delivery" && e.wickets.some((w) => w.kind !== "retired hurt"),
    );
    expect(wickets.length).toBeGreaterThan(5);
    const windows = (messages.at(-1)?.t ?? 0) / 10_000;
    const matchWide = messages.length / windows;
    const afterWicket =
      wickets
        .map((w) => messages.filter((m) => m.t >= w.t && m.t < w.t + 10_000).length)
        .reduce((sum, n) => sum + n, 0) / wickets.length;
    expect(afterWicket).toBeGreaterThanOrEqual(3 * matchWide);
  });

  // A session that seeks re-simulates a prefix of the timeline (Task 5): the messages for those
  // events must be exactly the full simulation's, so nothing appears, vanishes or changes.
  it("gives the same messages for a prefix of the timeline", () => {
    const { events, messages } = simulate(id, "session-a");
    const cut = Math.floor(events.length / 2);
    const prefixIds = new Set(events.slice(0, cut).map((e) => e.id));
    const match = loadMatch(id);
    const partial = simulateCrowd({
      events: events.slice(0, cut),
      players: match.players.players,
      corpus: loadCorpus(),
      seed: "session-a",
    });
    const fromPrefix = messages.filter((m) => prefixIds.has(m.id.split(":c")[0] ?? ""));
    expect(partial).toEqual(fromPrefix);
  });

  it("names players only from players.json", () => {
    const { messages } = simulate(id, "session-a");
    const shortNames = new Set(loadMatch(id).players.players.map((p) => p.shortName));
    const named = messages.filter((m) => [...shortNames].some((name) => m.text.includes(name)));
    expect(named.length).toBeGreaterThan(20);
  });
});

describe("crowd corpus (data/crowd/corpus.json)", () => {
  const corpus = loadCorpus();

  it("is synthetic, has at least 240 lines and covers every trigger", () => {
    expect(corpus.synthetic).toBe(true);
    expect(corpus.lines.length).toBeGreaterThanOrEqual(240);
    for (const trigger of CROWD_TRIGGERS) {
      expect(corpus.lines.filter((line) => line.trigger === trigger).length).toBeGreaterThan(0);
    }
    expect(new Set(corpus.lines.map((line) => line.id)).size).toBe(corpus.lines.length);
  });

  it("uses placeholders, never the names in either players.json, nor team names or codes", () => {
    const banned: { term: string; caseSensitive: boolean }[] = [];
    for (const id of MATCH_IDS) {
      const { players, context } = loadMatch(id);
      for (const p of players.players) {
        for (const name of [p.displayName, p.shortName, p.cricsheetName]) {
          banned.push({ term: name, caseSensitive: false });
        }
      }
      for (const team of context.teams) {
        banned.push({ term: team.name, caseSensitive: false });
        banned.push({ term: team.code, caseSensitive: true });
      }
    }
    const texts = [...corpus.lines.map((line) => line.text), ...corpus.handles];
    for (const { term, caseSensitive } of banned) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(
        `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`,
        caseSensitive ? "u" : "iu",
      );
      const hits = texts.filter((text) => re.test(text));
      expect(hits, `"${term}" appears in the corpus`).toEqual([]);
    }
    for (const line of corpus.lines) {
      for (const [, name] of line.text.matchAll(/\{(\w+)\}/g)) {
        expect(CHAT_PLACEHOLDERS).toContain(name);
      }
    }
  });
});
