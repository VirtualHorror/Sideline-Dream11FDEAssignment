/**
 * Play, pause, speed (1x-32x) and "jump to after N overs of an innings": the demo's remote control.
 * Caller: broadcast/TvPane.tsx; every action is a `ControlRequest` the match room POSTs to the session.
 * The server owns the clock: the UI changes when the answer (and, for a jump, the snapshot) arrives.
 */
import type { ControlRequest, InningsNumber, Speed } from "@sideline/engine";
import { useId, useState } from "react";

const SPEEDS: readonly Speed[] = [1, 2, 4, 8, 16, 32];
const OVERS = Array.from({ length: 20 }, (_, i) => i);

export function PlaybackControls({
  playing,
  speed,
  onControl,
  disabled = false,
}: {
  playing: boolean;
  speed: Speed;
  onControl(request: ControlRequest): void;
  disabled?: boolean;
}) {
  const speedName = useId();
  const [innings, setInnings] = useState<InningsNumber>(2);
  const [afterOvers, setAfterOvers] = useState(18);

  return (
    <div className="playback">
      <button
        type="button"
        className="button button--primary playback__toggle"
        disabled={disabled}
        onClick={() => onControl({ action: playing ? "pause" : "play" })}
      >
        {playing ? "Pause" : "Play"}
      </button>
      <fieldset className="segmented" disabled={disabled}>
        <legend className="sr-only">Speed</legend>
        {SPEEDS.map((value) => (
          <label key={value} className="segmented__option">
            <input
              type="radio"
              name={speedName}
              value={value}
              checked={speed === value}
              onChange={() => onControl({ action: "speed", value })}
            />
            <span>{value}x</span>
          </label>
        ))}
      </fieldset>
      <form
        className="playback__jump"
        onSubmit={(event) => {
          event.preventDefault();
          onControl({ action: "jump", target: { kind: "over", innings, afterOvers } });
        }}
      >
        <label className="field">
          <span className="field__label">Innings</span>
          <select
            className="field__select"
            value={innings}
            disabled={disabled}
            onChange={(event) => setInnings(event.target.value === "1" ? 1 : 2)}
          >
            <option value="1">1st</option>
            <option value="2">2nd</option>
          </select>
        </label>
        <label className="field">
          <span className="field__label">After overs</span>
          <select
            className="field__select"
            value={afterOvers}
            disabled={disabled}
            onChange={(event) => setAfterOvers(Number(event.target.value))}
          >
            {OVERS.map((over) => (
              <option key={over} value={over}>
                {over}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="button" disabled={disabled}>
          Jump
        </button>
      </form>
    </div>
  );
}
