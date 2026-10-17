/**
 * Play, pause, speed (1x-32x) and "jump to after N overs of an innings": the demo's remote control.
 * Caller: broadcast/TvPane.tsx; every action is a `ControlRequest` the match room POSTs to the session.
 * The server owns the clock. The buttons show the fan's choice at once and drop that guess when the
 * session's clock changes (the answer) or the request fails, so a slow network never makes a click look
 * ignored.
 */
import type { ControlRequest, InningsNumber, Speed } from "@sideline/engine";
import { useEffect, useId, useState } from "react";

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
  /** Resolves false when the session refused the request. */
  onControl(request: ControlRequest): Promise<boolean> | undefined;
  disabled?: boolean;
}) {
  const speedName = useId();
  const [innings, setInnings] = useState<InningsNumber>(2);
  const [afterOvers, setAfterOvers] = useState(18);
  const [guess, setGuess] = useState<{ speed?: Speed; playing?: boolean }>({});
  // biome-ignore lint/correctness/useExhaustiveDependencies: the session's clock answered: drop the guess
  useEffect(() => setGuess({}), [speed, playing]);
  const shownSpeed = guess.speed ?? speed;
  const shownPlaying = guess.playing ?? playing;
  const send = (request: ControlRequest, next: { speed?: Speed; playing?: boolean }) => {
    setGuess((current) => ({ ...current, ...next }));
    void onControl(request)?.then((ok) => {
      if (!ok) setGuess({});
    });
  };

  return (
    <div className="playback">
      <button
        type="button"
        className="button button--primary playback__toggle"
        disabled={disabled}
        onClick={() =>
          send({ action: shownPlaying ? "pause" : "play" }, { playing: !shownPlaying })
        }
      >
        {shownPlaying ? "Pause" : "Play"}
      </button>
      <fieldset className="segmented" disabled={disabled}>
        <legend className="sr-only">Speed</legend>
        {SPEEDS.map((value) => (
          <label key={value} className="segmented__option">
            <input
              type="radio"
              name={speedName}
              value={value}
              checked={shownSpeed === value}
              onChange={() => send({ action: "speed", value }, { speed: value })}
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
