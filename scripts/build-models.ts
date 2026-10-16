/**
 * Builds data/models/ from the Cricsheet men's T20I archive (PLAN Task 3).
 *
 * Usage:
 *   node scripts/build-models.ts               download the current archive into a temp dir
 *   node scripts/build-models.ts --zip <path>  rebuild from a saved copy of the archive
 *
 * Writes winprob-v1.json (chase and first-innings logistic models, held-out metrics, leverage
 * weights and the big-ball threshold), priors-<matchId>.json for every shipped demo match, and a
 * generated README.md with the counts behind them. Every archive match is accounted for: used,
 * filtered (PLAN rules), a demo match, or rejected by the engine with a named reason (BUG-002).
 * The same zip always rebuilds byte-identical files: matches are visited in id order, objects are
 * built in a fixed key order, and nothing reads the clock except `retrievedAt` for a new archive.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyEvent,
  CHASE_FEATURE_NAMES,
  chaseFeatures,
  createMatchState,
  FantasyRulesSchema,
  FIRST_INNINGS_FEATURE_NAMES,
  fantasyPoints,
  firstInningsFeatures,
  fitLogistic,
  fnv1a32,
  type InningsState,
  leverage,
  type MatchEvent,
  type MatchState,
  PlayersFileSchema,
  type PriorsFile,
  PriorsFileSchema,
  predictLogistic,
  projectedPoints,
  type Role,
  round2,
  type WinProbModel,
  WinProbModelSchema,
} from "../packages/engine/src/index.ts";
import {
  ARCHIVE_URL,
  type ArchiveRaw,
  downloadArchive,
  extractArchive,
  filterReason,
  readArchiveMatch,
  runEngine,
  sha256File,
} from "./lib/archive.ts";

const ROOT = join(import.meta.dirname, "..");
const MODELS_DIR = join(ROOT, "data", "models");
const MODEL_PATH = join(MODELS_DIR, "winprob-v1.json");

// PLAN Task 3 build rules (decided there; change them only with the plan).
const FIT = { l2PerRow: 1e-4, maxIter: 50, tol: 1e-8 };
const TEST_SPLIT_MODULUS = 5;
const LEVERAGE_PERCENTILE = 0.95;
const DEFAULT_LEVERAGE_WEIGHTS = {
  swing: 2,
  wicket: 0.15,
  six: 0.12,
  four: 0.06,
  noball: 0.08,
  freeHit: 0.04,
};
const PRIOR_APPEARANCES = 10;
const PRIOR_K = 3;
const WICKETS_PER_INNINGS = 10;
const CALIBRATION_BINS = 10;

interface Row {
  x: number[];
  y: 0 | 1;
}

interface DemoMatch {
  id: string;
  date: string;
  players: { id: string; role: Role; displayName: string }[];
}

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const isTestMatch = (id: string) => fnv1a32(id) % TEST_SPLIT_MODULUS === 0;
const round6 = (x: number) => Math.round(x * 1e6) / 1e6;
const byNumericId = (a: string, b: string) => Number(a) - Number(b);
const count = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

function parseArgs(argv: string[]): { zip: string | null } {
  if (argv.length === 0) return { zip: null };
  if (argv.length === 2 && argv[0] === "--zip" && argv[1]) return { zip: argv[1] };
  throw new Error("usage: node scripts/build-models.ts [--zip <path>]");
}

/** The committed date is kept for the same archive, so a rebuild never depends on the clock. */
function resolveRetrievedAt(sha256: string, zipArg: string | null): string {
  if (existsSync(MODEL_PATH)) {
    const committed = WinProbModelSchema.safeParse(readJson(MODEL_PATH));
    if (committed.success && committed.data.trainedOn.sha256 === sha256) {
      return committed.data.trainedOn.retrievedAt;
    }
  }
  const when = zipArg ? statSync(zipArg).mtime : new Date();
  return when.toISOString().slice(0, 10);
}

function loadDemoMatches(): DemoMatch[] {
  const manifest = readJson(join(ROOT, "data", "raw", "cricsheet", "manifest.json")) as {
    matches: { id: string; file: string }[];
  };
  return manifest.matches.map(({ id, file }) => {
    const raw = readJson(join(ROOT, "data", "raw", "cricsheet", file)) as ArchiveRaw;
    const date = raw.info.dates[0];
    if (!date) throw new Error(`demo match ${id} has no date`);
    const players = PlayersFileSchema.parse(
      readJson(join(ROOT, "data", "matches", id, "players.json")),
    );
    return {
      id,
      date,
      players: players.players.map(({ id: playerId, role, displayName }) => ({
        id: playerId,
        role,
        displayName,
      })),
    };
  });
}

/**
 * Chase features for a live chase, or null once it is decided (target reached, all out, out of
 * balls): those states are settled by winProbability's rules and are not training rows.
 */
function chaseRow(innings: InningsState): number[] | null {
  if (!innings.target) throw new Error("a chasing innings must carry its target");
  const runsNeeded = innings.target.runs - innings.runs;
  const ballsLeft = innings.target.balls - innings.legalBalls;
  const wicketsLeft = WICKETS_PER_INNINGS - innings.wickets;
  if (runsNeeded <= 0 || ballsLeft <= 0 || wicketsLeft <= 0) return null;
  return chaseFeatures(runsNeeded, ballsLeft, wicketsLeft);
}

/**
 * Training rows for one accepted match (PLAN): chase rows before the first ball of innings 2 and
 * after every legal ball of it, labelled "the chasing side won"; first-innings rows after every
 * legal ball of innings 1, labelled "the side batting first won". A tie labels both sides 0.
 */
function matchRows(id: string, events: readonly MatchEvent[], final: MatchState) {
  const [first, second] = final.innings;
  if (!first || !second) throw new Error(`${id}: an accepted match must have two innings`);
  const winner = final.result?.winner ?? null;
  const chaseLabel: 0 | 1 = winner !== null && winner === second.battingTeam ? 1 : 0;
  const firstLabel: 0 | 1 = winner !== null && winner === first.battingTeam ? 1 : 0;
  const chase: Row[] = [];
  const firstInnings: Row[] = [];
  const state = createMatchState(id);
  for (const event of events) {
    applyEvent(state, event);
    if (event.kind === "innings_start" && event.innings === 2) {
      const row = state.innings[1] && chaseRow(state.innings[1]);
      if (row) chase.push({ x: row, y: chaseLabel });
    } else if (event.kind === "delivery" && event.isLegal) {
      const innings = state.innings[event.innings - 1];
      if (!innings) throw new Error(`${id}: delivery for a missing innings`);
      if (event.innings === 1) {
        firstInnings.push({
          x: firstInningsFeatures(innings.runs, innings.wickets, innings.legalBalls),
          y: firstLabel,
        });
      } else {
        const row = chaseRow(innings);
        if (row) chase.push({ x: row, y: chaseLabel });
      }
    }
  }
  return { chase, firstInnings };
}

function fitModel(rows: Row[]): number[] {
  return fitLogistic(rows, { l2: FIT.l2PerRow * rows.length, maxIter: FIT.maxIter, tol: FIT.tol });
}

/** Brier score, log loss and a ten-bin reliability table on held-out rows. */
function metrics(weights: number[], rows: Row[]) {
  let brier = 0;
  let logLoss = 0;
  const bins = Array.from({ length: CALIBRATION_BINS }, () => ({
    predicted: 0,
    observed: 0,
    n: 0,
  }));
  for (const row of rows) {
    const p = predictLogistic(weights, row.x);
    brier += (p - row.y) ** 2;
    const clipped = Math.min(Math.max(p, 1e-15), 1 - 1e-15);
    logLoss -= row.y === 1 ? Math.log(clipped) : Math.log(1 - clipped);
    const bin = bins[Math.min(CALIBRATION_BINS - 1, Math.floor(p * CALIBRATION_BINS))];
    if (!bin) throw new Error("calibration bin out of range");
    bin.predicted += p;
    bin.observed += row.y;
    bin.n += 1;
  }
  return {
    brierTest: round6(brier / rows.length),
    logLossTest: round6(logLoss / rows.length),
    calibration: bins.flatMap((bin, index) =>
      bin.n === 0
        ? []
        : [
            {
              bin: index,
              predicted: round6(bin.predicted / bin.n),
              observed: round6(bin.observed / bin.n),
              n: bin.n,
            },
          ],
    ),
  };
}

/** Nearest-rank percentile: the smallest value with at least `p` of the sample at or below it. */
function nearestRank(sortedAscending: number[], p: number): number {
  const rank = Math.max(1, Math.ceil(p * sortedAscending.length - 1e-9));
  const value = sortedAscending[rank - 1];
  if (value === undefined) throw new Error("percentile of an empty sample");
  return value;
}

/** Leverage of every legal delivery in a match, copying the state before each ball. */
function legalBallLeverage(
  id: string,
  events: readonly MatchEvent[],
  model: WinProbModel,
): number[] {
  const state = createMatchState(id);
  const values: number[] = [];
  for (const event of events) {
    if (event.kind !== "delivery" || !event.isLegal) {
      applyEvent(state, event);
      continue;
    }
    const before = structuredClone(state);
    applyEvent(state, event);
    values.push(leverage({ before, after: state, event, model }).value);
  }
  return values;
}

interface Appearance {
  matchId: string;
  date: string;
}

/**
 * Priors for one demo match (PLAN): each squad player's 10 most recent T20I appearances strictly
 * before the match date, where an appearance is a match with the player in an announced XI that
 * the engine accepts (a rejected match is replaced by the next most recent), scored by the real
 * fantasy engine with the player's own role and everyone else BAT. Then
 * projected = (Σ points + k·roleMean[role]) / (n + k), with roleMean pooled over the squad.
 */
function buildPriors(
  demo: DemoMatch,
  appearancesByPlayer: Map<string, Appearance[]>,
  rawDir: string,
  rules: ReturnType<typeof FantasyRulesSchema.parse>,
  source: string,
): PriorsFile {
  const records = demo.players.map((player) => {
    const candidates = (appearancesByPlayer.get(player.id) ?? [])
      .filter((appearance) => appearance.date < demo.date)
      .sort((a, b) =>
        a.date === b.date ? byNumericId(b.matchId, a.matchId) : a.date < b.date ? 1 : -1,
      );
    const appearances: { matchId: string; date: string; points: number }[] = [];
    for (const candidate of candidates) {
      if (appearances.length === PRIOR_APPEARANCES) break;
      const run = runEngine(candidate.matchId, readArchiveMatch(rawDir, candidate.matchId), (id) =>
        id === player.id ? player.role : undefined,
      );
      if (!run.ok) continue;
      const points = fantasyPoints(run.state, run.players.players, rules).get(player.id);
      if (!points) throw new Error(`${candidate.matchId}: ${player.id} is in the XI but unscored`);
      appearances.push({ matchId: candidate.matchId, date: candidate.date, points: points.total });
    }
    return { player, appearances };
  });

  const roles: Role[] = ["WK", "BAT", "AR", "BOWL"];
  const pooled = (role: Role | null) => {
    const points = records
      .filter((record) => role === null || record.player.role === role)
      .flatMap((record) => record.appearances.map((appearance) => appearance.points));
    return points.length === 0
      ? null
      : points.reduce((sum, value) => sum + value, 0) / points.length;
  };
  // A role nobody in the squad has played would have no mean; fall back to the squad's overall
  // mean (no squad needs it today, see data/models/README.md). round2 is the engine's rounding,
  // the same one projectedPoints applies.
  const overall = pooled(null) ?? 0;
  const roleMean = {
    WK: round2(pooled("WK") ?? overall),
    BAT: round2(pooled("BAT") ?? overall),
    AR: round2(pooled("AR") ?? overall),
    BOWL: round2(pooled("BOWL") ?? overall),
  } satisfies Record<(typeof roles)[number], number>;

  const draft: PriorsFile = {
    matchId: demo.id,
    asOf: demo.date,
    source,
    k: PRIOR_K,
    roleMean,
    players: {},
  };
  for (const { player, appearances } of records) {
    draft.players[player.id] = { role: player.role, appearances, projected: 0 };
  }
  for (const { player } of records) {
    const entry = draft.players[player.id];
    if (entry) entry.projected = projectedPoints(player.id, draft);
  }
  return PriorsFileSchema.parse(draft);
}

interface BuildSummary {
  zipEntries: number;
  filtered: Map<string, number>;
  demoIds: string[];
  rejected: Map<string, string[]>;
  used: { train: number; test: number };
  ties: { id: string; bowlOut: boolean }[];
  rows: { chaseTrain: number; chaseTest: number; firstTrain: number; firstTest: number };
  leverageSample: number;
  leverageShareAtOrAbove: number;
}

function table(header: string[], rows: string[][]): string {
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  return [line(header), line(header.map(() => "---")), ...rows.map(line)].join("\n");
}

function readme(
  model: WinProbModel,
  priors: PriorsFile[],
  demos: DemoMatch[],
  summary: BuildSummary,
): string {
  const filteredTotal = [...summary.filtered.values()].reduce((sum, n) => sum + n, 0);
  const rejectedTotal = [...summary.rejected.values()].reduce((sum, ids) => sum + ids.length, 0);
  const usedTotal = summary.used.train + summary.used.test;
  const byCount = <T>(entries: [string, T][], size: (value: T) => number) =>
    [...entries].sort((a, b) => size(b[1]) - size(a[1]) || (a[0] < b[0] ? -1 : 1));
  const featureTable = (part: WinProbModel["chase"]) =>
    table(
      ["Feature", "Weight"],
      part.features.map((name, index) => [`\`${name}\``, String(part.weights[index])]),
    );
  const calibrationTable = (part: WinProbModel["metrics"]["chase"]) =>
    table(
      ["Predicted bin", "Mean predicted", "Observed win rate", "States"],
      part.calibration.map((bin) => [
        `${(bin.bin / 10).toFixed(1)}-${((bin.bin + 1) / 10).toFixed(1)}`,
        bin.predicted.toFixed(3),
        bin.observed.toFixed(3),
        count(bin.n),
      ]),
    );
  const ties = summary.ties;
  const bowlOuts = ties.filter((tie) => tie.bowlOut).map((tie) => tie.id);

  const priorSections = priors.map((file) => {
    const demo = demos.find((candidate) => candidate.id === file.matchId);
    const names = new Map(demo?.players.map((player) => [player.id, player.displayName]));
    const short = Object.entries(file.players)
      .filter(([, entry]) => entry.appearances.length < PRIOR_APPEARANCES)
      .map(([id, entry]) => `${names.get(id) ?? id} (${entry.appearances.length})`);
    const full = Object.values(file.players).filter(
      (entry) => entry.appearances.length === PRIOR_APPEARANCES,
    ).length;
    return [
      `### \`priors-${file.matchId}.json\` (as of ${file.asOf})`,
      "",
      `${full} of ${Object.keys(file.players).length} squad players have ${PRIOR_APPEARANCES} appearances.` +
        (short.length > 0
          ? ` Fewer: ${short.join(", ")}; the formula shrinks a short record toward the role mean.`
          : ""),
      "",
      table(
        ["Role", "Mean points per appearance"],
        (["WK", "BAT", "AR", "BOWL"] as const).map((role) => [
          role,
          file.roleMean[role].toFixed(2),
        ]),
      ),
    ].join("\n");
  });

  return `${[
    "# data/models",
    "",
    "Generated by `scripts/build-models.ts` (PLAN Task 3). Do not edit these files by hand: change the",
    "script and rebuild. Biome skips this folder because the files must rebuild byte-for-byte.",
    "",
    table(
      ["File", "What"],
      [
        [
          "`winprob-v1.json`",
          "Win-probability model (chase and first-innings logistic regressions), held-out metrics, leverage weights and the big-ball threshold",
        ],
        ...priors.map((file) => [
          `\`priors-${file.matchId}.json\``,
          `Pre-match fantasy projections for the ${file.matchId} squads`,
        ]),
        ["`README.md`", "This summary, generated with the files"],
      ],
    ),
    "",
    "## Source",
    "",
    `- Archive: ${model.trainedOn.source} (Cricsheet, Open Data Commons Attribution License 1.0)`,
    `- Retrieved: ${model.trainedOn.retrievedAt}`,
    `- sha256: \`${model.trainedOn.sha256}\``,
    `- Match files: ${count(summary.zipEntries)}`,
    "",
    "## Regenerate",
    "",
    "```bash",
    "node scripts/build-models.ts                # downloads the current archive",
    "node scripts/build-models.ts --zip <path>   # rebuilds from a saved archive",
    "```",
    "",
    "The same zip always rebuilds byte-identical files, and `retrievedAt` is kept while the sha256 is",
    "unchanged. Cricsheet republishes the archive as matches are added, so a new download changes the",
    "sha256, the counts and the weights. To be able to rebuild exactly later, download the archive",
    "once, keep the file, and build from it:",
    "",
    "```bash",
    `curl -fsSL -o t20s_male_json.zip ${model.trainedOn.source}`,
    "sha256sum t20s_male_json.zip                # the build records this value in the files",
    "node scripts/build-models.ts --zip t20s_male_json.zip",
    "```",
    "",
    "## Matches",
    "",
    table(
      ["Step", "Matches"],
      [
        ["Match files in the archive", count(summary.zipEntries)],
        [
          `Shipped demo matches, never trained on (${summary.demoIds.join(", ")})`,
          count(summary.demoIds.length),
        ],
        ...byCount([...summary.filtered.entries()], (n) => n).map(([reason, n]) => [
          `Excluded by the PLAN filters: ${reason}`,
          count(n),
        ]),
        ["Rejected by the engine (docs/bugs/BUG-002)", count(rejectedTotal)],
        [
          `Used: train / test (\`fnv1a32(matchId) % ${TEST_SPLIT_MODULUS} === 0\`)`,
          `${count(usedTotal)}: ${count(summary.used.train)} / ${count(summary.used.test)}`,
        ],
      ],
    ),
    "",
    `${count(summary.zipEntries - summary.demoIds.length - filteredTotal)} matches pass the filters; the engine accepts ${count(usedTotal)} of them.`,
    "Rejected ids are in `trainedOn.excludedMatchIds` with the demo matches:",
    "",
    table(
      ["Engine rejection", "Matches", "Ids"],
      byCount([...summary.rejected.entries()], (ids) => ids.length).map(([reason, ids]) => [
        reason,
        String(ids.length),
        ids.join(" "),
      ]),
    ),
    "",
    `Ties among the used matches: ${ties.length} (${ties.map((tie) => tie.id).join(", ")}); settled by a bowl-out: ${bowlOuts.length === 0 ? "none" : bowlOuts.join(", ")}. A tie labels both sides 0: a bowl-out is not a win. Ties that went to a super over have more than two innings, so the filters exclude them.`,
    "",
    "## Win probability (`winprob-v1.json`)",
    "",
    "Chase rows: the state before the first ball of innings 2 and after every legal ball of it, skipping",
    "decided states, labelled 1 when the chasing side won. First-innings rows: after every legal ball of",
    "innings 1, labelled 1 when the side batting first won. Fit: Newton/IRLS with a ridge penalty",
    `\`l2 = ${FIT.l2PerRow} × rows\`, at most ${FIT.maxIter} iterations, step tolerance ${FIT.tol}.`,
    "Metrics are on the held-out test split only.",
    "",
    table(
      ["Model", "Train states", "Test states", "Brier (test)", "Log loss (test)"],
      [
        [
          "Chase",
          count(summary.rows.chaseTrain),
          count(summary.rows.chaseTest),
          model.metrics.chase.brierTest.toFixed(4),
          model.metrics.chase.logLossTest.toFixed(4),
        ],
        [
          "First innings",
          count(summary.rows.firstTrain),
          count(summary.rows.firstTest),
          model.metrics.firstInnings.brierTest.toFixed(4),
          model.metrics.firstInnings.logLossTest.toFixed(4),
        ],
      ],
    ),
    "",
    "### Chase model",
    "",
    featureTable(model.chase),
    "",
    calibrationTable(model.metrics.chase),
    "",
    "### First-innings model",
    "",
    featureTable(model.firstInnings),
    "",
    calibrationTable(model.metrics.firstInnings),
    "",
    "## Leverage",
    "",
    "`value = clamp(swing·|ΔP| + spectacle·closeness, 0, 1)`, with the weights below (PLAN defaults).",
    `\`nudgeThreshold\` is the nearest-rank ${model.leverage.percentile} percentile of the value over all`,
    `${count(summary.leverageSample)} legal deliveries in the test split: ${model.leverage.nudgeThreshold}.`,
    `${(summary.leverageShareAtOrAbove * 100).toFixed(2)}% of those deliveries are at or above it.`,
    "",
    table(
      ["Weight", "Value"],
      Object.entries(model.leverage.weights).map(([name, value]) => [name, String(value)]),
    ),
    "",
    "## Player priors",
    "",
    `Each squad player's ${PRIOR_APPEARANCES} most recent T20I appearances strictly before the match date, scored by`,
    "the fantasy engine with the player's own role (everyone else BAT). An appearance is a match with the",
    "player in an announced XI that the engine accepts; a rejected match is replaced by the next most recent.",
    `\`projected = (Σ points + k·roleMean[role]) / (n + k)\` with \`k = ${PRIOR_K}\` and \`roleMean\` pooled over the`,
    "squad's appearances.",
    "",
    priorSections.join("\n\n"),
  ].join("\n")}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const demos = loadDemoMatches();
  const demoIds = new Set(demos.map((demo) => demo.id));
  const squadIds = new Set(demos.flatMap((demo) => demo.players.map((player) => player.id)));
  const rules = FantasyRulesSchema.parse(readJson(join(ROOT, "data", "rules", "t20-fantasy.json")));

  const work = mkdtempSync(join(tmpdir(), "sideline-models-"));
  try {
    const zipPath = args.zip ?? (await downloadArchive(work));
    const sha256 = sha256File(zipPath);
    const retrievedAt = resolveRetrievedAt(sha256, args.zip);
    const rawDir = join(work, "raw");
    const ids = extractArchive(zipPath, rawDir);
    console.log(
      `build-models: ${count(ids.length)} match files, sha256 ${sha256}, retrieved ${retrievedAt}`,
    );

    const filtered = new Map<string, number>();
    const rejected = new Map<string, string[]>();
    const appearancesByPlayer = new Map<string, Appearance[]>();
    const train = { chase: [] as Row[], firstInnings: [] as Row[] };
    const test = { chase: [] as Row[], firstInnings: [] as Row[] };
    const testIds: string[] = [];
    const ties: { id: string; bowlOut: boolean }[] = [];
    let trainMatches = 0;

    for (const id of ids) {
      const raw = readArchiveMatch(rawDir, id);
      for (const team of raw.info.teams) {
        for (const name of raw.info.players[team] ?? []) {
          const playerId = raw.info.registry.people[name];
          if (!playerId || !squadIds.has(playerId)) continue;
          const date = raw.info.dates[0] ?? "";
          appearancesByPlayer.set(playerId, [
            ...(appearancesByPlayer.get(playerId) ?? []),
            { matchId: id, date },
          ]);
        }
      }
      if (demoIds.has(id)) continue;
      const reason = filterReason(raw);
      if (reason) {
        filtered.set(reason, (filtered.get(reason) ?? 0) + 1);
        continue;
      }
      const run = runEngine(id, raw);
      if (!run.ok) {
        rejected.set(run.reason, [...(rejected.get(run.reason) ?? []), id]);
        continue;
      }
      if (run.state.result?.winner === null)
        ties.push({ id, bowlOut: raw.info.outcome?.bowl_out !== undefined });
      const rows = matchRows(id, run.events, run.state);
      const split = isTestMatch(id) ? test : train;
      split.chase.push(...rows.chase);
      split.firstInnings.push(...rows.firstInnings);
      if (isTestMatch(id)) testIds.push(id);
      else trainMatches += 1;
    }

    const usedTotal = trainMatches + testIds.length;
    const filteredTotal = [...filtered.values()].reduce((sum, n) => sum + n, 0);
    const rejectedIds = [...rejected.values()].flat();
    if (usedTotal + filteredTotal + rejectedIds.length + demoIds.size !== ids.length) {
      throw new Error("build-models: archive accounting does not add up; a match was skipped");
    }

    const chaseWeights = fitModel(train.chase);
    const firstWeights = fitModel(train.firstInnings);
    const draft: WinProbModel = {
      version: "winprob-v1",
      trainedOn: {
        source: ARCHIVE_URL,
        sha256,
        retrievedAt,
        nMatches: usedTotal,
        nTrainStates: train.chase.length + train.firstInnings.length,
        nTestStates: test.chase.length + test.firstInnings.length,
        excludedMatchIds: [...demoIds, ...rejectedIds].sort(byNumericId),
      },
      chase: { features: [...CHASE_FEATURE_NAMES], weights: chaseWeights },
      firstInnings: { features: [...FIRST_INNINGS_FEATURE_NAMES], weights: firstWeights },
      metrics: {
        chase: metrics(chaseWeights, test.chase),
        firstInnings: metrics(firstWeights, test.firstInnings),
      },
      leverage: {
        weights: DEFAULT_LEVERAGE_WEIGHTS,
        nudgeThreshold: 0,
        percentile: LEVERAGE_PERCENTILE,
      },
    };

    // The threshold comes from the test split only, re-run through the engine after the fit.
    const sample: number[] = [];
    for (const id of testIds) {
      const run = runEngine(id, readArchiveMatch(rawDir, id));
      if (!run.ok) throw new Error(`${id}: accepted in the first pass but rejected now`);
      sample.push(...legalBallLeverage(id, run.events, draft));
    }
    sample.sort((a, b) => a - b);
    const nudgeThreshold = nearestRank(sample, LEVERAGE_PERCENTILE);
    const model = WinProbModelSchema.parse({
      ...draft,
      leverage: { ...draft.leverage, nudgeThreshold },
    });

    const priorsSource = `${ARCHIVE_URL} (sha256 ${sha256})`;
    const priors = demos.map((demo) =>
      buildPriors(demo, appearancesByPlayer, rawDir, rules, priorsSource),
    );

    const summary: BuildSummary = {
      zipEntries: ids.length,
      filtered,
      demoIds: [...demoIds],
      rejected,
      used: { train: trainMatches, test: testIds.length },
      ties,
      rows: {
        chaseTrain: train.chase.length,
        chaseTest: test.chase.length,
        firstTrain: train.firstInnings.length,
        firstTest: test.firstInnings.length,
      },
      leverageSample: sample.length,
      leverageShareAtOrAbove:
        sample.filter((value) => value >= nudgeThreshold).length / sample.length,
    };

    mkdirSync(MODELS_DIR, { recursive: true });
    writeFileSync(MODEL_PATH, `${JSON.stringify(model, null, 2)}\n`);
    for (const file of priors) {
      writeFileSync(
        join(MODELS_DIR, `priors-${file.matchId}.json`),
        `${JSON.stringify(file, null, 2)}\n`,
      );
    }
    writeFileSync(join(MODELS_DIR, "README.md"), readme(model, priors, demos, summary));

    console.log(
      `build-models: ${count(filteredTotal)} filtered, ${demoIds.size} demo, ${rejectedIds.length} rejected by the engine, ${count(usedTotal)} used (train ${count(trainMatches)}, test ${testIds.length})`,
    );
    console.log(
      `build-models: chase Brier ${model.metrics.chase.brierTest}, first-innings Brier ${model.metrics.firstInnings.brierTest}`,
    );
    console.log(
      `build-models: nudgeThreshold ${nudgeThreshold} over ${count(sample.length)} test-split legal balls`,
    );
    console.log(
      `build-models: wrote ${["winprob-v1.json", ...priors.map((p) => `priors-${p.matchId}.json`), "README.md"].join(", ")}`,
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

await main();
