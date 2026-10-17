/**
 * Quest rules as a model writes them, for the skills whose predictions the engine settles (bailout
 * quests, room-read polls; PLAN 8.2-8.3). Strict structured output is most portable without unions,
 * so the model fills one flat object with every field and nulls the unused ones; `toQuestRule` turns
 * it into a real QuestRule (contracts/moments.ts) or refuses it, and `ruleSpan` gives the legal balls
 * the rule is about, which the skills' guards check against their windows.
 */
import { type QuestRule, QuestRuleSchema } from "@sideline/engine";
import { z } from "zod";

/** A QuestRule as the model writes it: one flat object with every field, the unused ones null. */
export const RuleDraftSchema = z.strictObject({
  type: z.enum([
    "runs_in_over",
    "wicket_in_window",
    "boundary_in_window",
    "dots_in_window",
    "batter_runs_by",
  ]),
  innings: z.number().int(),
  over: z.number().int().nullable(),
  fromLegalBall: z.number().int().nullable(),
  toLegalBall: z.number().int().nullable(),
  boundary: z.enum(["4", "6", "any"]).nullable(),
  op: z.enum(["gte", "lte"]).nullable(),
  value: z.number().int().nullable(),
  playerId: z.string().nullable(),
  byLegalBall: z.number().int().nullable(),
});
export type RuleDraft = z.infer<typeof RuleDraftSchema>;

/** The QuestRule a draft describes, or null when its fields do not make one. */
export function toQuestRule(draft: RuleDraft): QuestRule | null {
  const { type, innings } = draft;
  const window = { fromLegalBall: draft.fromLegalBall, toLegalBall: draft.toLegalBall };
  const candidate = (() => {
    switch (type) {
      case "runs_in_over":
        return { type, innings, over: draft.over, op: draft.op, value: draft.value };
      case "wicket_in_window":
        return { type, innings, ...window };
      case "boundary_in_window":
        return {
          type,
          innings,
          ...window,
          boundary:
            draft.boundary === null || draft.boundary === "any"
              ? draft.boundary
              : Number(draft.boundary),
        };
      case "dots_in_window":
        return { type, innings, ...window, op: draft.op, value: draft.value };
      case "batter_runs_by":
        return {
          type,
          innings,
          playerId: draft.playerId,
          byLegalBall: draft.byLegalBall,
          op: draft.op,
          value: draft.value,
        };
    }
  })();
  const parsed = QuestRuleSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/** The legal balls a rule is about: an over's six, a window, or a batter's tally up to a ball. */
export function ruleSpan(rule: QuestRule): { from: number; to: number } {
  switch (rule.type) {
    case "runs_in_over":
      return { from: rule.over * 6 + 1, to: rule.over * 6 + 6 };
    case "batter_runs_by":
      return { from: rule.byLegalBall, to: rule.byLegalBall };
    default:
      return { from: rule.fromLegalBall, to: rule.toLegalBall };
  }
}
