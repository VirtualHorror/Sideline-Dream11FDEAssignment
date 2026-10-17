/**
 * The scale projection (Architecture §6): one model call per event per viewer against Sideline's one
 * call per shared moment, with the server's formula and its substituted numbers shown verbatim.
 * Caller: controlplane/ControlPlaneDrawer.tsx.
 */
import type { ScaleProjection } from "@sideline/engine";
import { formatCount } from "./Counters.tsx";

export function Projection({ projection }: { projection: ScaleProjection }) {
  return (
    <section className="cp-section" aria-label="Scale projection">
      <h3 className="cp-section__title">At {formatCount(projection.concurrentViewers)} viewers</h3>
      <p className="cp-projection__headline">
        <span className="cp-projection__num">{formatCount(projection.sidelineLlmCalls)}</span> model
        calls with Sideline, against{" "}
        <span className="cp-projection__num">{formatCount(projection.naiveLlmCalls)}</span> for one
        call per event per viewer.
      </p>
      <p className="cp-projection__formula">{projection.formula}</p>
    </section>
  );
}
