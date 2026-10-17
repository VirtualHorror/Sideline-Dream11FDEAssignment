/**
 * The watch-along chat, released on the fan's TV clock like everything else, so a crowd's "OUT!"
 * never beats their picture. In the demo every line is the synthetic crowd (data/crowd, one crowd per
 * match, D-050), and the panel says so: "Simulated crowd" (Constraint 2).
 *
 * Caller: pages/MatchRoom.tsx with the chat lines the TV has reached. It follows the newest line
 * unless the fan has scrolled up to read.
 */
import type { ChatMessage, Team } from "@sideline/engine";
import { useEffect, useRef } from "react";

const SHOWN = 60;
const LANG: Record<ChatMessage["lang"], string> = { en: "en", hinglish: "hi-Latn", hi: "hi" };

export function ChatFeed({
  messages,
  teams,
}: {
  messages: readonly ChatMessage[];
  teams: readonly Team[];
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const shown = messages.slice(-SHOWN);
  const newest = shown.at(-1)?.id;
  const synthetic = messages.length === 0 || messages.some((m) => m.synthetic);

  useEffect(() => {
    const list = listRef.current;
    if (!list || newest === undefined) return;
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    if (nearBottom || list.scrollTop === 0) list.scrollTop = list.scrollHeight;
  }, [newest]);

  return (
    <section className="chat" aria-label="Watch-along chat">
      <header className="chat__head">
        <h2 className="chat__title">Watch-along chat</h2>
        {synthetic ? <span className="pill">Simulated crowd</span> : null}
      </header>
      {shown.length === 0 ? (
        <p className="chat__empty">The crowd warms up as the match starts.</p>
      ) : (
        <ol ref={listRef} className="chat__list">
          {shown.map((message) => {
            const team = teams.find((t) => t.code === message.affinity);
            return (
              <li key={message.id} className="chat__line" lang={LANG[message.lang]}>
                <span
                  className="chat__affinity"
                  style={team ? { background: team.color } : undefined}
                  title={team ? `${team.name} fan` : "Neutral"}
                />
                <span className="chat__handle">{message.handle}</span>
                <span className="chat__text">{message.text}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
