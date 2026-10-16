/**
 * Auditor's engine dumper (Task 2 audit; reused by later audits).
 *
 * Runs buildTimeline + applyEvent on each match and writes `<id>.dump.json`: the events, a
 * snapshot of the live situation, partnership and innings totals after every delivery, the final
 * state, and a fold-vs-step spot check. `check_spec.py` then re-derives every value from the raw
 * file with no engine code. A match the engine rejects gets `<id>.dump.err` with the reason.
 * Not part of the product; implementers never edit scripts/oracle/ (Constraint 5).
 *
 * Usage: node scripts/oracle/audit/dump_engine.ts <raw-dir> <fixtures-dir> <out-dir> [ids...]
 *   <fixtures-dir>/<id>/{players,context}.json: gen_fixtures.py output, or data/matches.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyEvent,
  buildTimeline,
  createMatchState,
  foldEvents,
  type InningsState,
  MatchContextFileSchema,
  type MatchState,
  PlayersFileSchema,
} from "../../../packages/engine/src/index.ts";

interface Snapshot {
  seq: number;
  live: MatchState["live"];
  partnership: InningsState["partnership"];
  runs: number;
  wickets: number;
  legalBalls: number;
}

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

function dumpMatch(id: string, rawDir: string, fixturesDir: string, outDir: string): void {
  const raw = readJson(join(rawDir, `${id}.json`));
  const players = PlayersFileSchema.parse(readJson(join(fixturesDir, id, "players.json")));
  const context = MatchContextFileSchema.parse(readJson(join(fixturesDir, id, "context.json")));
  const events = buildTimeline({ raw, players, context });
  const state = createMatchState(id);
  const snaps: Snapshot[] = [];
  for (const event of events) {
    applyEvent(state, event);
    if (event.kind !== "delivery") continue;
    const innings = state.innings.find((candidate) => candidate.innings === event.innings);
    if (!innings) throw new Error(`no innings state after ${event.id}`);
    // Copies, not references: the reducer keeps mutating the same partnership object.
    snaps.push({
      seq: event.seq,
      live: structuredClone(state.live),
      partnership: structuredClone(innings.partnership),
      runs: innings.runs,
      wickets: innings.wickets,
      legalBalls: innings.legalBalls,
    });
  }
  const third = Math.floor(events.length / 3);
  const foldMismatch = [0, third, 2 * third, events.length - 1].filter((cut) => {
    const stepped = createMatchState(id);
    for (const event of events) {
      if (event.seq > cut) break;
      applyEvent(stepped, event);
    }
    return JSON.stringify(foldEvents(id, events, cut)) !== JSON.stringify(stepped);
  });
  writeFileSync(
    join(outDir, `${id}.dump.json`),
    JSON.stringify({ id, events, snaps, final: state, foldMismatch }),
  );
}

function main(): void {
  const [rawDir, fixturesDir, outDir, ...only] = process.argv.slice(2);
  if (!rawDir || !fixturesDir || !outDir) {
    console.error(
      "Usage: node scripts/oracle/audit/dump_engine.ts <raw-dir> <fixtures-dir> <out-dir> [ids...]",
    );
    process.exitCode = 2;
    return;
  }
  const ids =
    only.length > 0
      ? only
      : readdirSync(fixturesDir).filter((dir) =>
          existsSync(join(fixturesDir, dir, "players.json")),
        );
  let dumped = 0;
  let rejected = 0;
  for (const id of ids) {
    try {
      dumpMatch(id, rawDir, fixturesDir, outDir);
      dumped += 1;
    } catch (error) {
      rejected += 1;
      const reason = error instanceof Error ? error.message : String(error);
      writeFileSync(join(outDir, `${id}.dump.err`), reason);
    }
  }
  console.log(`dump_engine: ${dumped} dumped, ${rejected} rejected by the engine`);
}

if (import.meta.main) main();
