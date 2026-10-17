# Design system

> The visual and verbal rules for Sideline. Tokens live in `apps/web/src/styles/tokens.css`;
> effects are specified in `VISUAL_REFERENCES.md`. When this document and the code disagree,
> fix whichever is wrong in the same change.

## 1. Direction: a night match under floodlights

Subject: a live T20 match watched on a second screen. Audience: Indian cricket fans from casual to
obsessive, and Dream11's product and engineering reviewers. Primary job: keep the fan in the game
at the four moments it breaks, while showing honestly when AI is involved.

The vernacular we design from:
- **Floodlights**: the reference's rising light cone *is* the floodlit sky over a night game. It
  lives at the bottom of the hero and the TV pane, and it flares on big moments.
- **The scorebook and the stadium LED board**: in cricket a dot ball is literally written as a dot,
  and stadium boards are dot matrices. The ball-by-ball innings is drawn as a **dot-matrix**
  (20 rows × 6 legal balls), and the reference's dither pattern is the same visual language.
- **The broadcast scorebug**: condensed, tabular numbers in a compact strip.

Spend boldness in one place: the floodlight + ghost-text reveal on genuine big moments. Everything
else stays calm, aligned and quiet.

## 2. Colour

| Token | Light ("day match") | Dark ("floodlit night") | Use |
| --- | --- | --- | --- |
| `--bg` | `#F3F5FA` | `#080B14` (from reference) | page |
| `--surface-1/2/3` | `#FFFFFF` / `#E9EDF5` / `#DFE5F0` | `#0E1424` / `#141C30` / `#1B2540` | panels, raised, selected |
| `--ink` | `#0B1222` | `#F4F2FC` | primary text |
| `--ink-muted` | `#4A5675` | `#A2ABC6` | secondary text (AA on bg) |
| `--ink-faint` | `#5F6A88` | `#737D9B` | tertiary, large text only |
| `--line` / `--line-strong` | ink at 12% / 22% | `#A2ABC6` at 14% / 26% | hairlines, borders |
| `--fl-blue/cyan/violet/pink` | `#5171E8` `#69B9EC` `#7771BC` `#D165AA` | same | floodlight glow only |
| `--six` | `#B7791F` | `#FFC94A` | sixes, "maximum" |
| `--four` | `#1D7FB8` | `#69B9EC` | fours |
| `--wicket` | `#D7263D` | `#FF5468` | wickets (the scorer's red W) |
| `--dot` | `#8A93AD` | `#4C5571` | dot balls |
| `--team-a`, `--team-b` | from `context.json` at runtime | same | team identity, outbursts |
| `--on-six`, `--on-four`, `--on-wicket` | `#0B1222` / `#FFFFFF` / `#FFFFFF` | `#080B14` (all three) | text on a filled six, four or wicket cell (AA) |
| `--four-fill` | `#17699A` | `#69B9EC` | a filled four cell (the light `--four` is 4.4:1 against white text) |

The TV screen is a night picture in both themes, the way a video player stays dark on a light page:
the `.surface-night` class re-declares the dark values for everything drawn on it (scorebug, ghost
text, floodlight at full strength). Built in Task 6.

Rules: colour encodes cricket meaning (six, four, wicket, team), never decoration. Glow colours
appear only in the floodlight and input halo. Text always meets WCAG AA in both themes.

## 3. Type

One family: **Anek Latin** variable (Ek Type, Mumbai), self-hosted. The width axis is the
expressive axis.

| Role | Width | Weight | Size (px) | Notes |
| --- | --- | --- | --- | --- |
| Display (hero wordmark) | 125% | 800 | clamp(64, 14vw, 160) | GhostText effect, tracking −0.02em |
| H1 | 112% | 720 | clamp(36, 6.5vw, 72) | line-height 1.02 |
| H2 | 100% | 680 | 24-36 | |
| Card title | 100% | 640 | 18-21 | |
| Body | 100% | 400 | 16 / 1.6 | measure ≤ 72ch |
| Small / helper | 100% | 450 | 14 / 1.5 | |
| Scorebug numerals | 75-85% | 650 | 18-28 | `font-variant-numeric: tabular-nums` (verified) |
| Chips / labels | 90% | 560 | 12-13 | sentence case; team codes are naturally uppercase |

Scale steps follow the classic sequence 12, 14, 16, 18, 21, 24, 36, 48, 60, 72.

## 4. Shape, space, depth

- Radius hierarchy: panels 20, cards 14, controls 10, scorebug 6 (broadcast graphics are crisp),
  pills 999. Not one radius for everything.
- Spacing on a 4 px base; page gutters `clamp(16px, 4vw, 40px)`; 16 px minimum on phones.
- Depth from surface steps and hairlines, not drop shadows. The only glow is the floodlight family.

## 5. Layout

Landing (`/`):
```
┌──────────────────────────────────────────────────────────────┐
│ Sideline                                    Auto Light Dark  │
│                                                              │
│                 Sideline   ← GhostText, pointer-reactive     │
│           The match, on your clock.                          │
│   Pick a fan to watch as:  [Captain Babar] [Late from work]  │
│                            [F1 fan, first match]             │
│   Pakistan vs India, T20 World Cup 2022     [Start watching] │
│         ░░▒▒▓▓ floodlight cone rising from the bottom ▓▓▒▒░░ │
├──────────────────────────────────────────────────────────────┤
│ When Sideline uses AI, and when it doesn't (three columns)   │
├──────────────────────────────────────────────────────────────┤
│ footer: attribution line, data credit                         │
└──────────────────────────────────────────────────────────────┘
```

Match room, desktop (≥ 1200 px): TV pane left (about 58%), companion right, control plane drawer
docked at the bottom (collapsed to a one-line summary by default).
```
┌──────────────────────────────────────────────────────────────────────────┐
│ Sideline  Pakistan vs India   Toss ─ Powerplay ─ Middle ─ Death     ◐     │
├─────────────────────────────────────────┬────────────────────────────────┤
│ Your TV, 25 s behind the ground          │ Companion                      │
│ ┌─────────────────────────────────────┐ │  held spoiler (dither veil)     │
│ │ field graphic + scorebug             │ │  catch-me-up reel               │
│ │ floodlight edge, outbursts           │ │  explainer / take cards         │
│ └─────────────────────────────────────┘ │ Watch-along chat (simulated)    │
│ This over  ● ● 4 ● 1 W                   │                                 │
│ Innings dot-matrix (20 × 6)              │ [ Ask Sideline …          Tab ] │
│ Win probability line                     │                                 │
│ Play  Pause  1x 2x 4x 8x 16x  Delay ─●─  │                                 │
├─────────────────────────────────────────┴────────────────────────────────┤
│ Control plane: events │ handled without AI │ AI calls │ cache hits │ cost │
└──────────────────────────────────────────────────────────────────────────┘
```

Match room, phone (< 768 px): the companion is the primary view (it *is* a second screen).
A compact scorebug pins to the top (with the TV delay), tabs switch Companion / TV / Control plane,
and the composer pins to the bottom above the safe-area inset.

As built (Task 6): the two-column room starts at 960 px (TV about 58%, companion 42%, the companion
sticky with its own scroll); below 960 px the phone layout applies, the compact scorebug and the tabs
sharing one opaque sticky block. The landing hero holds the wordmark, tagline and lede, with the
floodlight rising from its bottom edge (as in the reference); the persona picker follows it as its own
section, then the three "when Sideline uses AI" columns.

Alignment: left-aligned content everywhere except the landing hero, which is centred (as in the
reference).

## 6. Motion

- Motion answers the match or the fan: reveals, outbursts, dissolves, state changes. No
  fade-and-slide on every section, no hover animation on every card.
- Durations: 120-200 ms for UI state, 350 ms for card entry, 900 ms for veil dissolves, 1.6 s for
  outburst settle. Easing `--ease-out` (`cubic-bezier(0.16, 1, 0.3, 1)`).
- `prefers-reduced-motion: reduce` stops ambient motion and replaces effects with opacity changes.

## 7. Components (inventory and status)

| Component | Status | Notes |
| --- | --- | --- |
| Shell (header, main, footer) | built T1 | attribution footer on every route |
| ThemeControl (Auto / Light / Dark) | built T1 | native radios, keyboard accessible |
| FloodlightGlow, GhostText, DitherVeil, GlowInput | built T6 | `VISUAL_REFERENCES.md`; each starts on its CSS fallback and upgrades only with WebGL2, no reduced motion and a real context |
| Scorebug, OverStrip, InningsDotMatrix, WinProbLine, Commentary | built T6 | numbers tabular; the matrix puts wides and no-balls as marks in the cell of the ball they preceded |
| PlaybackControls, DelayControl, PhaseRail | built T6 | phase rail is a real sequence, so numbered steps are fine there; buttons show the fan's choice at once |
| MomentCard variants: CatchUpReel, ExplainerCard, SpoilerCard | built T6 | each kind gets its own shape: the held ticket with two veiled zones, the reel of slides, the Q&A |
| PersonaPicker | built T6 | radio cards: label, blurb, stream delay, lens |
| SquadDiffLedger, BailoutQuestCard, BanterCard, RoomReadPods, TakeCard | Task 9 | |
| ControlPlaneDrawer (counters, gate log, traces, projection) | built T6 | rows about a ball the TV has not shown are held |
| InspectorQuery | Task 9 | |
| ProvenanceChip (Live AI / Cached / Replayed / Fallback / Rules) | built T6 | on every moment card and trace; each provenance has its own mark; "Replayed AI" has no date yet (the moment does not carry the recording date) |

## 8. Writing

- Sentence case everywhere. Plain verbs. Name things by what fans understand: "Your TV is 25 s
  behind the ground", not "delay buffer 25000 ms".
- Buttons say what happens: "Start watching", "Apply swap", "Share card".
- Errors say what happened and what to do, in the interface's voice, without apology.
- Provenance is always visible and plain: "Live AI", "Cached for everyone at this moment",
  "Replayed AI (recorded on <date>)", "Rules only", "Fallback: AI unavailable".
- Avoid: ALL-CAPS eyebrow labels, middle-dot meta strings, "→" appended to buttons, monospace for
  small labels, filler adjectives.
