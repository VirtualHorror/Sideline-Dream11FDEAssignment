/**
 * Lineup Patch (phase 1): the XIs are out and some of the fan's picks are not in them. A ledger: each
 * benched pick against the legal replacement Sideline suggests and the squad's credits after it, the
 * armbands, how the conditions shaped it, and whether the squad then passes every rule. The swaps were
 * proposed by the model (or the rules, in a fallback) and checked by the squad validator on the server.
 *
 * Caller: companion/MomentFeed.tsx. Held until the fan's TV shows the XIs (the card would be team news
 * ahead of the picture). The fan can ask for a different patch in their own words until their TV shows
 * the first ball, when fantasy teams lock (DOMAIN §3); the answer arrives as a new card.
 */
import { type Moment, momentVisibility, type Player } from "@sideline/engine";
import { useId, useState } from "react";
import { ProvenanceChip } from "../ProvenanceChip.tsx";
import { HeldCard } from "./HeldCard.tsx";

type LineupMoment = Extract<Moment, { kind: "lineup_patch" }>;

const credits = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function SquadDiffLedger({
  moment,
  tvT,
  players,
  locked,
  onIntent,
  pending = false,
  error = null,
}: {
  moment: LineupMoment;
  tvT: number;
  players: ReadonlyMap<string, Player>;
  /** The fan's TV has shown the first ball: teams are locked. */
  locked: boolean;
  onIntent(text: string): void;
  pending?: boolean;
  error?: string | null;
}) {
  const inputId = useId();
  const [text, setText] = useState("");
  if (momentVisibility(moment, tvT) !== "revealed") {
    return (
      <HeldCard
        kind="lineup_patch"
        note="Team news for your squad comes with the XIs on your stream."
      />
    );
  }
  const p = moment.payload;
  const name = (id: string) => players.get(id)?.displayName ?? id;
  const swapped = new Map(p.swaps.map((s) => [s.outId, s]));
  const benched = p.notPlaying.length;
  return (
    <article className="card card--ledger" data-kind="lineup_patch" data-visibility="revealed">
      <header className="card__head">
        <h3 className="card__title">Lineup patch</h3>
        <ProvenanceChip provenance={moment.provenance} />
      </header>
      <p className="card__body">
        {benched === 0
          ? "Every pick in your team is playing."
          : `${benched === 1 ? "1 pick" : `${benched} picks`} in your team ${benched === 1 ? "is" : "are"} not in either playing XI, so ${benched === 1 ? "it scores" : "they score"} nothing.`}
      </p>
      {p.intent ? <p className="ledger__intent">You asked: {p.intent}</p> : null}
      {benched > 0 ? (
        <div className="ledger__scroll">
          <table className="ledger">
            <thead>
              <tr>
                <th scope="col">Out</th>
                <th scope="col">In</th>
                <th scope="col">Credits after</th>
              </tr>
            </thead>
            <tbody>
              {p.notPlaying.map(({ playerId }) => {
                const swap = swapped.get(playerId);
                return (
                  <tr key={playerId}>
                    <td>
                      <span className="ledger__out">{name(playerId)}</span>
                    </td>
                    <td>
                      {swap ? (
                        <>
                          <span className="ledger__in">{name(swap.inId)}</span>
                          <span className="ledger__why">{swap.rationale}</span>
                        </>
                      ) : (
                        <span className="ledger__why">
                          No legal swap keeps the squad within the rules.
                        </span>
                      )}
                    </td>
                    <td className="ledger__credits">{swap ? credits(swap.creditsAfter) : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      <ul className="ledger__armbands">
        {p.captain ? (
          <li>
            <strong>Captain: {name(p.captain.playerId)}</strong>
            <span className="ledger__why">{p.captain.rationale}</span>
          </li>
        ) : null}
        {p.viceCaptain ? (
          <li>
            <strong>Vice-captain: {name(p.viceCaptain.playerId)}</strong>
            <span className="ledger__why">{p.viceCaptain.rationale}</span>
          </li>
        ) : null}
      </ul>
      <p className="ledger__conditions">{p.conditionsRead}</p>
      <p className="ledger__valid" data-valid={p.squadValid}>
        {p.squadValid
          ? "Your squad passes every rule after these swaps."
          : "These swaps leave a squad that breaks a rule."}
      </p>
      <form
        className="ledger__ask"
        onSubmit={(event) => {
          event.preventDefault();
          const request = text.trim();
          if (request && !locked && !pending) onIntent(request);
        }}
      >
        <label htmlFor={inputId} className="ledger__ask-label">
          Ask for a different patch
        </label>
        <div className="ledger__ask-row">
          <input
            id={inputId}
            className="ledger__ask-input"
            value={text}
            maxLength={280}
            placeholder="Rebalance for rain"
            disabled={locked || pending}
            onChange={(event) => setText(event.target.value)}
          />
          <button
            type="submit"
            className="button"
            disabled={locked || pending || text.trim() === ""}
          >
            {pending ? "Patching…" : "Patch again"}
          </button>
        </div>
        {locked ? <p className="card__note">Teams locked at the first ball on your TV.</p> : null}
        {error ? (
          <p className="card__note" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </article>
  );
}
