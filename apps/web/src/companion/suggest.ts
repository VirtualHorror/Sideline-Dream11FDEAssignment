/**
 * The composer's placeholder suggestion: a question about what the fan's TV just showed, computed
 * from the match state (never by a model, VISUAL_REFERENCES.md Effect D). Each one names a glossary
 * term, so the server answers it from data/glossary.json at no model cost (D-057).
 *
 * Caller: companion/Composer.tsx with the state folded to the TV time and the last delivery shown.
 */
import type { DeliveryEvent, MatchState, WicketKind } from "@sideline/engine";

const WICKET_QUESTIONS: Partial<Record<WicketKind, string>> = {
  bowled: "What does bowled mean?",
  caught: "What does caught mean?",
  "caught and bowled": "What does caught mean?",
  lbw: "What is LBW?",
  stumped: "What does stumped mean?",
  "run out": "What is a run out?",
};

export function suggestQuestion(state: MatchState, last: DeliveryEvent | null): string {
  if (last) {
    if (last.isFreeHit || last.extras.noballs > 0) return "What is a free hit?";
    const wicket = last.wickets.find((w) => w.kind !== "retired hurt");
    if (wicket) return WICKET_QUESTIONS[wicket.kind] ?? "What is a wicket?";
    if (last.extras.wides > 0) return "What is a wide?";
    if (last.extras.legbyes > 0) return "What is a leg bye?";
    if (last.extras.byes > 0) return "What is a bye?";
    if (last.boundary > 0) return "What is a boundary?";
  }
  const innings = state.innings.at(-1);
  if (!innings) return state.toss ? "What is a playing XI?" : "What is the toss?";
  if (innings.target && innings.status === "in_progress") return "What is the required run rate?";
  const over = Math.floor(innings.legalBalls / 6);
  if (over < 6) return "What is the powerplay?";
  if (over >= 15) return "What are the death overs?";
  return "What is a dot ball?";
}
