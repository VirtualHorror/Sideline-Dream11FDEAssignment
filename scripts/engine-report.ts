/**
 * Oracle-compatible scorecard report for one Cricsheet match.
 *
 * Reads a raw match plus authored player/rules fixtures, builds the canonical
 * timeline, and reports the folded state. Context is loaded beside players.json.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  buildTimeline,
  type DeliveryEvent,
  type FantasyRules,
  FantasyRulesSchema,
  fantasyPoints,
  foldEvents,
  type InningsState,
  type MatchContextFile,
  MatchContextFileSchema,
  type MatchEvent,
  type Player,
  type PlayersFile,
  PlayersFileSchema,
} from "../packages/engine/src/index.ts";

interface Options {
  rawPath: string;
  playersPath: string;
  rulesPath: string;
  json: boolean;
}

interface FieldingLine {
  catches: number;
  stumpings: number;
  ro_direct: number;
  ro_indirect: number;
}

interface ReportFallOfWicket {
  wicket: number;
  runs: number;
  label: string;
  player_id: string;
  kind: string;
  bowler_id: string;
}

interface ReportInnings {
  innings: number;
  team: string;
  totals: {
    runs: number;
    wickets: number;
    legal_balls: number;
    deliveries: number;
    extras: {
      wides: number;
      noballs: number;
      byes: number;
      legbyes: number;
      penalty: number;
    };
  };
  batters: Record<
    string,
    {
      name: string;
      runs: number;
      balls: number;
      fours: number;
      sixes: number;
      dots: number;
      out: string | null;
      strike_rate: number;
    }
  >;
  bowlers: Record<
    string,
    {
      name: string;
      legal_balls: number;
      conceded: number;
      wickets: number;
      lbw_bowled: number;
      maidens: number;
      dots: number;
      wides: number;
      noballs: number;
      overs: string;
      economy: number;
    }
  >;
  fall_of_wickets: ReportFallOfWicket[];
  fielding: Record<string, FieldingLine>;
}

interface Report {
  innings: ReportInnings[];
  fantasy: Record<string, { total: number; breakdown: Record<string, number> }>;
}

const usage =
  "Usage: node scripts/engine-report.ts <raw.json> --players <players.json> --rules <rules.json> [--json]";

function parseOptions(args: readonly string[]): Options {
  let rawPath: string | undefined;
  let playersPath: string | undefined;
  let rulesPath: string | undefined;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) continue;
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--players" || arg === "--rules") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a path.\n${usage}`);
      if (arg === "--players") playersPath = value;
      else rulesPath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}\n${usage}`);
    if (rawPath) throw new Error(`Unexpected positional argument: ${arg}\n${usage}`);
    rawPath = arg;
  }

  if (!rawPath || !playersPath || !rulesPath) throw new Error(usage);
  return { rawPath, playersPath, rulesPath, json };
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(resolve(path), "utf8")) as unknown;
}

function parseFixture<T>(path: string, schema: { parse: (value: unknown) => T }): T {
  try {
    return schema.parse(readJson(path));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${path}: ${reason}`);
  }
}

function nameFor(playersById: ReadonlyMap<string, Player>, playerId: string): string {
  const player = playersById.get(playerId);
  if (!player) throw new Error(`No player fixture exists for registry id ${playerId}`);
  return player.cricsheetName;
}

function displayNameFor(playersById: ReadonlyMap<string, Player>, playerId: string): string {
  const player = playersById.get(playerId);
  if (!player) throw new Error(`No player fixture exists for registry id ${playerId}`);
  return player.shortName;
}

function fieldingFor(deliveries: readonly DeliveryEvent[]): Record<string, FieldingLine> {
  const fielding: Record<string, FieldingLine> = {};
  const add = (playerId: string, kind: keyof FieldingLine) => {
    let line = fielding[playerId];
    if (!line) {
      line = { catches: 0, stumpings: 0, ro_direct: 0, ro_indirect: 0 };
      fielding[playerId] = line;
    }
    line[kind] += 1;
  };

  for (const delivery of deliveries) {
    for (const wicket of delivery.wickets) {
      if (wicket.kind === "caught" && wicket.fielders[0]) add(wicket.fielders[0], "catches");
      else if (wicket.kind === "caught and bowled") add(delivery.bowler, "catches");
      else if (wicket.kind === "stumped" && wicket.fielders[0]) {
        add(wicket.fielders[0], "stumpings");
      } else if (wicket.kind === "run out" && wicket.fielders.length > 0) {
        const directFielder = wicket.fielders[0];
        if (wicket.fielders.length === 1 && directFielder) add(directFielder, "ro_direct");
        else {
          for (const playerId of wicket.fielders.slice(-2)) add(playerId, "ro_indirect");
        }
      }
    }
  }
  return fielding;
}

function reportInnings(
  innings: InningsState,
  allDeliveries: readonly DeliveryEvent[],
  teamsByCode: ReadonlyMap<string, string>,
  playersById: ReadonlyMap<string, Player>,
): ReportInnings {
  const deliveries = allDeliveries.filter((delivery) => delivery.innings === innings.innings);
  const eventById = new Map(deliveries.map((delivery) => [delivery.id, delivery]));
  const lbwBowled = new Map<string, number>();
  for (const delivery of deliveries) {
    for (const wicket of delivery.wickets) {
      if (wicket.kind === "lbw" || wicket.kind === "bowled") {
        lbwBowled.set(delivery.bowler, (lbwBowled.get(delivery.bowler) ?? 0) + 1);
      }
    }
  }

  const batters = Object.fromEntries(
    innings.batters.map((batter) => [
      batter.playerId,
      {
        name: nameFor(playersById, batter.playerId),
        runs: batter.runs,
        balls: batter.balls,
        fours: batter.fours,
        sixes: batter.sixes,
        dots: batter.dots,
        out: batter.out?.kind ?? null,
        strike_rate: batter.strikeRate,
      },
    ]),
  );
  const bowlers = Object.fromEntries(
    innings.bowlers.map((bowler) => [
      bowler.playerId,
      {
        name: nameFor(playersById, bowler.playerId),
        legal_balls: bowler.legalBalls,
        conceded: bowler.runsConceded,
        wickets: bowler.wickets,
        lbw_bowled: lbwBowled.get(bowler.playerId) ?? 0,
        maidens: bowler.maidens,
        dots: bowler.dots,
        wides: bowler.wides,
        noballs: bowler.noballs,
        overs: bowler.oversText,
        economy: bowler.economy,
      },
    ]),
  );
  const fallOfWickets = innings.fallOfWickets.map((fall) => {
    const delivery = eventById.get(fall.eventId);
    const wicket = delivery?.wickets.find((candidate) => candidate.playerOut === fall.playerOut);
    if (!delivery || !wicket) throw new Error(`Missing wicket event ${fall.eventId}`);
    return {
      wicket: fall.wicket,
      runs: fall.runs,
      label: fall.label,
      player_id: fall.playerOut,
      kind: wicket.kind,
      bowler_id: delivery.bowler,
    };
  });
  const extras = innings.extras;

  return {
    innings: innings.innings,
    team: teamsByCode.get(innings.battingTeam) ?? innings.battingTeam,
    totals: {
      runs: innings.runs,
      wickets: innings.wickets,
      legal_balls: innings.legalBalls,
      deliveries: deliveries.length,
      extras: {
        wides: extras.wides,
        noballs: extras.noballs,
        byes: extras.byes,
        legbyes: extras.legbyes,
        penalty: extras.penalty,
      },
    },
    batters,
    bowlers,
    fall_of_wickets: fallOfWickets,
    fielding: fieldingFor(deliveries),
  };
}

function buildReport(
  state: ReturnType<typeof foldEvents>,
  events: readonly MatchEvent[],
  players: PlayersFile,
  rules: FantasyRules,
  context: MatchContextFile,
): Report {
  const playersById = new Map(players.players.map((player) => [player.id, player]));
  const teamsByCode = new Map(context.teams.map((team) => [team.code, team.cricsheetName]));
  const deliveries = events.filter((event): event is DeliveryEvent => event.kind === "delivery");
  const points = fantasyPoints(state, players.players, rules);

  return {
    innings: state.innings.map((innings) =>
      reportInnings(innings, deliveries, teamsByCode, playersById),
    ),
    fantasy: Object.fromEntries(
      [...points].map(([playerId, score]) => [
        playerId,
        { total: score.total, breakdown: score.breakdown },
      ]),
    ),
  };
}

function printReadable(report: Report, players: PlayersFile): void {
  const playersById = new Map(players.players.map((player) => [player.id, player]));
  for (const innings of report.innings) {
    const totals = innings.totals;
    const legalBalls = totals.legal_balls;
    console.log(
      `== Innings ${innings.innings} ${innings.team}: ${totals.runs}/${totals.wickets} ` +
        `(${Math.floor(legalBalls / 6)}.${legalBalls % 6} ov, ${totals.deliveries} deliveries) ` +
        `extras=${JSON.stringify(totals.extras)}`,
    );
    for (const [playerId, batter] of Object.entries(innings.batters)) {
      if (batter.balls === 0 && !batter.out) continue;
      console.log(
        `   BAT ${displayNameFor(playersById, playerId).padEnd(22)} ` +
          `${String(batter.runs).padStart(3)} (${String(batter.balls).padStart(2)})  ` +
          `4s=${batter.fours} 6s=${batter.sixes} dots=${batter.dots} ` +
          `SR=${batter.strike_rate} out=${batter.out}`,
      );
    }
    for (const [playerId, bowler] of Object.entries(innings.bowlers)) {
      console.log(
        `   BOWL ${displayNameFor(playersById, playerId).padEnd(21)} ` +
          `${bowler.overs.padStart(4)}-${bowler.maidens}-${String(bowler.conceded).padStart(2)}-` +
          `${bowler.wickets} econ=${bowler.economy} dots=${bowler.dots} ` +
          `wd=${bowler.wides} nb=${bowler.noballs}`,
      );
    }
    const fow = innings.fall_of_wickets
      .map(
        (fall) =>
          `${fall.runs}-${fall.wicket} (${displayNameFor(playersById, fall.player_id)}, ${fall.label})`,
      )
      .join(", ");
    console.log(`   FOW ${fow}`);
  }

  console.log("== Fantasy points");
  const fantasy = Object.entries(report.fantasy).sort(
    (left, right) => right[1].total - left[1].total,
  );
  for (const [playerId, score] of fantasy) {
    console.log(
      `   ${displayNameFor(playersById, playerId).padEnd(14)} ` +
        `${String(score.total).padStart(6)}  ${JSON.stringify(score.breakdown)}`,
    );
  }
}

function main(): void {
  try {
    const options = parseOptions(process.argv.slice(2));
    const raw = readJson(options.rawPath);
    const players = parseFixture(options.playersPath, PlayersFileSchema);
    const rules = parseFixture(options.rulesPath, FantasyRulesSchema);
    const contextPath = join(dirname(resolve(options.playersPath)), "context.json");
    const context = parseFixture(contextPath, MatchContextFileSchema);
    if (context.matchId !== players.matchId) {
      throw new Error(
        `players/context match ids differ (${players.matchId} and ${context.matchId})`,
      );
    }

    const events = buildTimeline({ raw, players, context });
    const state = foldEvents(players.matchId, events);
    const report = buildReport(state, events, players, rules, context);
    if (options.json) console.log(JSON.stringify(report, null, 1));
    else printReadable(report, players);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (import.meta.main) main();
