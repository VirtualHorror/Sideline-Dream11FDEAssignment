/**
 * How far the fan's stream runs behind the ground (Architecture "Time model": stadium 0, cable about
 * 15 s, OTT about 25 s, a slow stream about 40 s; at most 60 s). Changing it moves the TV clock only:
 * the server re-anchors the session clock and nothing refolds there, because the delay buffer lives in
 * the browser (Flow §7, §9). Caller: broadcast/TvPane.tsx.
 */
import { type ControlRequest, MAX_DELAY_MS } from "@sideline/engine";
import { useEffect, useId, useState } from "react";

const PRESETS = [
  { label: "At the ground", ms: 0 },
  { label: "Cable", ms: 15_000 },
  { label: "OTT app", ms: 25_000 },
  { label: "Slow stream", ms: 40_000 },
] as const;

export function DelayControl({
  delayMs,
  onControl,
  disabled = false,
}: {
  delayMs: number;
  onControl(request: ControlRequest): void;
  disabled?: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState(delayMs);
  useEffect(() => setDraft(delayMs), [delayMs]);
  const seconds = Math.round(draft / 1000);

  return (
    <div className="delay">
      <label className="delay__label" htmlFor={id}>
        Your TV is <strong>{seconds} s</strong> behind the ground
      </label>
      <input
        id={id}
        className="delay__slider"
        type="range"
        min={0}
        max={MAX_DELAY_MS / 1000}
        step={1}
        value={seconds}
        disabled={disabled}
        onChange={(event) => setDraft(Number(event.target.value) * 1000)}
        onPointerUp={() => draft !== delayMs && onControl({ action: "delay", ms: draft })}
        onKeyUp={() => draft !== delayMs && onControl({ action: "delay", ms: draft })}
      />
      <div className="delay__presets">
        {PRESETS.map((preset) => (
          <button
            key={preset.ms}
            type="button"
            className="chip-button"
            aria-pressed={delayMs === preset.ms}
            disabled={disabled}
            onClick={() => onControl({ action: "delay", ms: preset.ms })}
          >
            {preset.label}, {preset.ms / 1000} s
          </button>
        ))}
      </div>
    </div>
  );
}
