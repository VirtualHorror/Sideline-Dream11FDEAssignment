/**
 * "Pick a fan to watch as": reviewers have no Dream11 account, so they choose a persona (D-029): a
 * fantasy team or none, a stream delay, a way of explaining, a moment they open the app. Everything
 * shown comes from GET /api/matches (data/matches/<id>/personas.json), never from code.
 *
 * Callers: pages/Landing.tsx and pages/MatchRoom.tsx (a match link opened without a persona). The
 * choice travels as `?persona=<id>`; the match room creates the session with it.
 */
import { useId, useState } from "react";
import { LENS_DESCRIPTIONS } from "../companion/LensSwitch.tsx";
import type { MatchListing } from "../lib/api.ts";

const dateText = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));

export function PersonaPicker({
  matches,
  onStart,
  onStory,
}: {
  matches: readonly MatchListing[];
  onStart(matchId: string, personaId: string): void;
  /** The guided story of the chosen match (story mode, Task 9); absent, no story button. */
  onStory?(matchId: string): void;
}) {
  const groupName = useId();
  const matchName = useId();
  const [matchId, setMatchId] = useState(matches[0]?.id ?? "");
  const match = matches.find((m) => m.id === matchId) ?? matches[0];
  const [personaId, setPersonaId] = useState(match?.personas[0]?.id ?? "");
  if (!match) return <p className="notice">No matches are available right now.</p>;
  const chosen = match.personas.find((p) => p.id === personaId) ?? match.personas[0];

  return (
    <form
      className="picker"
      onSubmit={(event) => {
        event.preventDefault();
        if (chosen) onStart(match.id, chosen.id);
      }}
    >
      {matches.length > 1 ? (
        <fieldset className="picker__matches">
          <legend className="picker__legend">Match</legend>
          <div className="picker__match-options">
            {matches.map((m) => (
              <label key={m.id} className="picker__match">
                <input
                  type="radio"
                  name={matchName}
                  value={m.id}
                  checked={m.id === match.id}
                  onChange={() => {
                    setMatchId(m.id);
                    setPersonaId(m.personas[0]?.id ?? "");
                  }}
                />
                <span className="picker__match-title">{m.title}</span>
                <span className="picker__match-meta">{m.competition}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <fieldset className="picker__personas">
        <legend className="picker__legend">Pick a fan to watch as</legend>
        <div className="picker__persona-options">
          {match.personas.map((persona) => (
            <label key={persona.id} className="persona">
              <input
                type="radio"
                name={groupName}
                value={persona.id}
                checked={persona.id === chosen?.id}
                onChange={() => setPersonaId(persona.id)}
              />
              <span className="persona__label">{persona.label}</span>
              <span className="persona__blurb">{persona.blurb}</span>
              <span className="persona__facts">
                <span>Stream {Math.round(persona.delayMs / 1000)} s behind the ground</span>
                <span>{LENS_DESCRIPTIONS[persona.lens]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="picker__go">
        <p className="picker__where">
          {match.title}, {match.stage}. {match.venue}, {dateText(match.date)}.
        </p>
        <div className="picker__buttons">
          <button type="submit" className="button button--primary button--large">
            Start watching
          </button>
          {onStory ? (
            <button
              type="button"
              className="button button--large"
              onClick={() => onStory(match.id)}
            >
              Watch the story
            </button>
          ) : null}
        </div>
      </div>
    </form>
  );
}
