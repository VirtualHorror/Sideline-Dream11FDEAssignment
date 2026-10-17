/**
 * How Sideline explains the game to this fan: plain English, an analyst's view, or another sport's
 * terms (the persona's lens by default). Changing it sends a `lens` control: future catch-ups and
 * answers use it (Flow §7). Caller: pages/MatchRoom.tsx.
 */
import type { Lens } from "@sideline/engine";
import { useId } from "react";

export const LENS_LABELS: Record<Lens, string> = {
  casual: "Plain English",
  analyst: "Analyst",
  f1: "F1",
  football: "Football",
  engineer: "Engineer",
};

export const LENS_DESCRIPTIONS: Record<Lens, string> = {
  casual: "Explained in plain English",
  analyst: "Explained like an analyst",
  f1: "Explained in Formula 1 terms",
  football: "Explained in football terms",
  engineer: "Explained like an engineer",
};

export function LensSwitch({
  lens,
  onChange,
  disabled = false,
}: {
  lens: Lens;
  onChange(lens: Lens): void;
  disabled?: boolean;
}) {
  const name = useId();
  return (
    <fieldset className="segmented segmented--small" disabled={disabled}>
      <legend className="sr-only">Explain it in</legend>
      {(Object.keys(LENS_LABELS) as Lens[]).map((value) => (
        <label key={value} className="segmented__option">
          <input
            type="radio"
            name={name}
            value={value}
            checked={lens === value}
            onChange={() => onChange(value)}
          />
          <span className="segmented__text">{LENS_LABELS[value]}</span>
        </label>
      ))}
    </fieldset>
  );
}
