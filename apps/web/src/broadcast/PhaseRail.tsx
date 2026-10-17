/**
 * Where the match is, as a real sequence (toss, then each innings' powerplay, middle overs and death
 * overs), and a way to jump to the start of any phase (DESIGN_SYSTEM §7: numbered steps are fine
 * here because the phases are a sequence).
 *
 * Caller: pages/MatchRoom.tsx with the state folded to the fan's TV time. A jump goes to the server
 * (POST control), which refolds the session and sends a fresh snapshot; jumping ahead past twelve
 * unseen legal balls also earns a catch-up reel (Flow §7).
 */
import type { JumpTarget, MatchState } from "@sideline/engine";

/** T20 phase boundaries in completed overs: the powerplay is overs 1-6, the death overs 16-20. */
const PHASES = [
  { id: "powerplay", label: "Powerplay", fromOver: 0 },
  { id: "middle", label: "Middle overs", fromOver: 6 },
  { id: "death", label: "Death overs", fromOver: 15 },
] as const;

function currentPhase(state: MatchState): string {
  if (state.result) return "result";
  const innings = state.innings.at(-1);
  if (!innings) return "toss";
  const over = Math.floor(innings.legalBalls / 6);
  const phase = [...PHASES].reverse().find((p) => over >= p.fromOver) ?? PHASES[0];
  return `${innings.innings}:${phase.id}`;
}

export function PhaseRail({
  state,
  onJump,
  disabled = false,
}: {
  state: MatchState;
  onJump(target: JumpTarget): void;
  disabled?: boolean;
}) {
  const current = currentPhase(state);
  const step = (id: string, label: string, target: JumpTarget, accessible: string) => (
    <li key={id}>
      <button
        type="button"
        className="rail__step"
        data-phase={id}
        aria-current={current === id ? "step" : undefined}
        aria-label={accessible}
        disabled={disabled}
        onClick={() => onJump(target)}
      >
        {label}
      </button>
    </li>
  );
  return (
    <nav className="rail" aria-label="Match phases">
      <ol className="rail__steps">
        {step("toss", "Toss", { kind: "toss" }, "Toss")}
        {([1, 2] as const).map((innings) => (
          <li key={innings} className="rail__innings">
            <span className="rail__innings-label">{innings === 1 ? "1st" : "2nd"}</span>
            <ol className="rail__group">
              {PHASES.map((phase) =>
                step(
                  `${innings}:${phase.id}`,
                  phase.label,
                  { kind: "over", innings, afterOvers: phase.fromOver },
                  `${innings === 1 ? "1st" : "2nd"} innings ${phase.label.toLowerCase()}`,
                ),
              )}
            </ol>
          </li>
        ))}
        <li>
          <span
            className="rail__step rail__step--end"
            data-phase="result"
            aria-current={current === "result" ? "step" : undefined}
          >
            Result
          </span>
        </li>
      </ol>
    </nav>
  );
}
