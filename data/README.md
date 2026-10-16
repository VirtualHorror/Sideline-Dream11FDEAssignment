# data/

Everything Sideline knows about cricket comes from here, never from code.

| Path | What | Source | Edited by |
| --- | --- | --- | --- |
| `raw/cricsheet/<id>.json` | Real ball-by-ball match data | [Cricsheet](https://cricsheet.org), Open Data Commons Attribution License 1.0 | `scripts/fetch-cricsheet.ts` only |
| `raw/cricsheet/manifest.json` | Which matches ship, source URL, licence, sha256 of each file | authored + script | script updates checksums |
| `matches/<id>/players.json` | Full 15-player squads (XI + bench), display names, fantasy roles, illustrative credits, Cricsheet registry ids | public squad announcements; ids from the Cricsheet people register | hand, validated by `pnpm check:data` |
| `matches/<id>/context.json` | Title, stage, team codes and colours, sourced pre-match notes | public reporting (URLs in each note) | hand |
| `matches/<id>/personas.json` | Demo fans: squad, captain/VC, affinity, lens, stream delay, join point | authored | hand; squads must pass `validateSquad` |
| `rules/t20-fantasy.json` | Team rules and points table (illustrative Dream11-style values) | commonly cited Dream11 T20 table; see its `disclaimer` | hand |
| `models/` (Task 3) | Trained win-probability model, leverage threshold, player priors, and a generated README with every count and exclusion | Cricsheet men's T20I archive (`t20s_male_json.zip`, sha256 in the files) | `scripts/build-models.ts` only (byte-reproducible; Biome-excluded) |
| `crowd/corpus.json` (Task 4) | Synthetic watch-along chat: 303 lines over 16 triggers, made-up handles, reaction rates; placeholders only, no real names (rules in `crowd/README.md`) | authored, labelled synthetic | hand; `CrowdCorpusSchema` and `crowd.test.ts` check it |
| `glossary.json` (Task 5) | Cricket terms in plain English | authored | hand |
| `ai-replay/` (Task 7) | Recorded real model outputs for keyless demos | `pnpm ai:record` | script only |
| `runtime/` | SQLite database at run time (git-ignored) | server | server |

Matches shipped:
- **1298150**: Pakistan vs India, ICC Men's T20 World Cup 2022, Melbourne Cricket Ground, 23 Oct 2022 (primary demo).
- **1415755**: India vs South Africa, ICC Men's T20 World Cup 2024 Final, Kensington Oval, 29 Jun 2024 (generalisation).

Attribution (required by ODC-By 1.0): ball-by-ball data from Cricsheet (https://cricsheet.org),
used under the Open Data Commons Attribution License 1.0
(http://opendatacommons.org/licenses/by/1.0/). Shown in the app footer and on the How it works page.

Check integrity any time: `pnpm check:data` (local) and `node scripts/fetch-cricsheet.ts --check`
(compares against a fresh download).
