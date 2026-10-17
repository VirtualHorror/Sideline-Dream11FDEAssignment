/**
 * The pipeline as one picture (PLAN 9.4): real ball-by-ball data → the engine → the entropy gate,
 * where most events stop at rules and a few become moments for the AI gateway → moments with their
 * provenance → the fan's own TV clock, which holds them until their stream shows the ball. Drawn twice
 * from the same nodes, across for wide screens and down for phones (CSS shows one), in theme colours.
 *
 * Caller: pages/Architecture.tsx.
 */
import { useId } from "react";

const NODES = [
  { id: "data", title: "Ball-by-ball data", sub: "Cricsheet, real matches" },
  { id: "engine", title: "Engine", sub: "score, fantasy, models" },
  { id: "gate", title: "Entropy gate", sub: "rules on every event" },
  { id: "ai", title: "AI gateway", sub: "cache, guards, fallback" },
  { id: "moments", title: "Moments", sub: "each with its provenance" },
  { id: "tv", title: "Your TV clock", sub: "holds every spoiler" },
] as const;

type Box = { x: number; y: number };
const W = 150;
const H = 58;

/** Boxes left to right on one line, the AI gateway raised above the rules-only path. */
const ACROSS: Record<(typeof NODES)[number]["id"], Box> = {
  data: { x: 10, y: 82 },
  engine: { x: 180, y: 82 },
  gate: { x: 350, y: 82 },
  ai: { x: 520, y: 10 },
  moments: { x: 690, y: 82 },
  tv: { x: 860, y: 82 },
};
/** The same boxes top to bottom, the AI gateway set to the side of the rules-only path. */
const DOWN: Record<(typeof NODES)[number]["id"], Box> = {
  data: { x: 20, y: 10 },
  engine: { x: 20, y: 98 },
  gate: { x: 20, y: 186 },
  ai: { x: 190, y: 274 },
  moments: { x: 20, y: 362 },
  tv: { x: 20, y: 450 },
};

function Diagram({ layout, className }: { layout: typeof ACROSS; className: string }) {
  const titleId = useId();
  const descId = useId();
  const across = layout === ACROSS;
  const right = (b: Box) => ({ x: b.x + W, y: b.y + H / 2 });
  const left = (b: Box) => ({ x: b.x, y: b.y + H / 2 });
  const bottom = (b: Box) => ({ x: b.x + W / 2, y: b.y + H });
  const top = (b: Box) => ({ x: b.x + W / 2, y: b.y });
  const from = across ? right : bottom;
  const to = across ? left : top;
  const line = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    `M${a.x} ${a.y} L${b.x} ${b.y}`;
  const L = layout;
  const viewBox = across ? "0 0 1020 160" : "0 0 360 520";
  return (
    <svg
      className={`pipeline ${className}`}
      viewBox={viewBox}
      role="img"
      aria-labelledby={`${titleId} ${descId}`}
    >
      <title id={titleId}>How a delivery travels through Sideline</title>
      <desc id={descId}>
        Ball-by-ball data feeds the engine; the entropy gate runs rules on every event; most events
        stop there with no model call, and only high-entropy moments go to the AI gateway, which
        caches, guards and falls back; every moment carries its provenance and waits on the fan's
        own TV clock until their stream shows the ball.
      </desc>
      <defs>
        <marker
          id={`${titleId}-arrow`}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0 0 L10 5 L0 10 z" className="pipeline__head" />
        </marker>
      </defs>
      <g className="pipeline__edges" markerEnd={`url(#${titleId}-arrow)`}>
        <path d={line(from(L.data), to(L.engine))} />
        <path d={line(from(L.engine), to(L.gate))} />
        <path
          className="pipeline__ai"
          d={across ? line(right(L.gate), left(L.ai)) : line(bottom(L.gate), top(L.ai))}
        />
        <path
          className="pipeline__ai"
          d={across ? line(right(L.ai), left(L.moments)) : line(bottom(L.ai), top(L.moments))}
        />
        <path className="pipeline__rules" d={line(from(L.gate), to(L.moments))} />
        <path d={line(from(L.moments), to(L.tv))} />
      </g>
      <text className="pipeline__note" x={across ? 520 : 30} y={across ? 150 : 300}>
        most events: rules only
      </text>
      {NODES.map((node) => {
        const box = L[node.id];
        return (
          <g key={node.id} className={`pipeline__node pipeline__node--${node.id}`}>
            <rect x={box.x} y={box.y} width={W} height={H} rx="10" />
            <text x={box.x + 12} y={box.y + 24} className="pipeline__title">
              {node.title}
            </text>
            <text x={box.x + 12} y={box.y + 44} className="pipeline__sub">
              {node.sub}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function PipelineDiagram() {
  return (
    <figure className="pipeline-figure">
      <Diagram layout={ACROSS} className="pipeline--across" />
      <Diagram layout={DOWN} className="pipeline--down" />
    </figure>
  );
}
