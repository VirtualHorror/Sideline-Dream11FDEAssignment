/**
 * Where a card's words came from, on every moment card (PLAN Task 6, DESIGN_SYSTEM §7-8).
 *
 * Callers: every card in companion/cards and the control plane's trace list. The labels are the
 * design system's plain wording; a fallback template must never read as AI, so each provenance has
 * its own mark and the fallback says outright that AI was unavailable.
 */
import type { Provenance } from "@sideline/engine";

export const PROVENANCE_LABELS: Record<Provenance, string> = {
  deterministic: "Rules only",
  live: "Live AI",
  cache: "Cached for everyone at this moment",
  replay: "Replayed AI",
  fallback: "Fallback: AI unavailable",
};

const PROVENANCE_HINTS: Record<Provenance, string> = {
  deterministic: "Computed by Sideline's rules from the match data. No model involved.",
  live: "Written by the AI model for this moment just now.",
  cache: "The AI wrote this once for this moment; every fan here sees the same words.",
  replay: "Recorded from a real AI call earlier and replayed, because no AI key is set.",
  fallback: "The AI was unavailable or its answer failed a check, so a labelled template was used.",
};

export function ProvenanceChip({ provenance }: { provenance: Provenance }) {
  return (
    <span className="provenance" data-provenance={provenance} title={PROVENANCE_HINTS[provenance]}>
      <span className="provenance__mark" aria-hidden="true" />
      {PROVENANCE_LABELS[provenance]}
    </span>
  );
}
