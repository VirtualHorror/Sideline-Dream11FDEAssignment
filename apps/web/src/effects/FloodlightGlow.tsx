/**
 * FloodlightGlow (Effect A, CSS): the floodlit sky rising from the bottom of the landing hero and the
 * TV screen. Four blurred blobs drift and cycle blue → cyan → violet → pink (styles/effects.css),
 * masked into a cone; a faint beam falls from the top. Meaning: the stadium lights.
 *
 * Callers: pages/Landing.tsx (ambient) and broadcast/TvPane.tsx (low ambient plus outbursts). The
 * outburst (`burstRef.current.burst(colour, strength)`) flares the cone towards a colour and settles
 * back over 1.6 s. TvPane fires it only when a big moment is revealed on the fan's TV clock, never
 * on stadium time, or the light itself would be the spoiler. Reduced motion: a static cone, and the
 * outburst becomes a 300 ms opacity pulse.
 */
import { type CSSProperties, type Ref, useImperativeHandle, useRef } from "react";
import { useReducedMotion } from "./webgl.ts";

export interface FloodlightHandle {
  /** Flares the lights towards `color`; strength above 1 also lasts longer (a result). */
  burst(color: string, strength?: number): void;
}

const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
const RISE_MS = 350;
const SETTLE_MS = 1600;

export function FloodlightGlow({
  intensity = 1,
  burstRef,
}: {
  intensity?: number;
  burstRef?: Ref<FloodlightHandle>;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const coneRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useImperativeHandle(
    burstRef,
    () => ({
      burst(color, strength = 1) {
        const root = rootRef.current;
        const cone = coneRef.current;
        if (!root || !cone) return;
        root.dataset.burst = color;
        root.style.setProperty("--fl-burst-color", color);
        // jsdom and very old browsers have no Web Animations: the colour is still recorded.
        if (typeof root.animate !== "function") return;
        if (reduced) {
          root
            .querySelector<HTMLElement>(".floodlight__pulse")
            ?.animate([{ opacity: 0 }, { opacity: 0.55 }, { opacity: 0 }], { duration: 300 });
          return;
        }
        const total = RISE_MS + SETTLE_MS * Math.max(1, strength);
        const peak = RISE_MS / total;
        cone.animate(
          [
            { transform: "scale(1)", filter: "brightness(1)" },
            { transform: "scale(1.35)", filter: "brightness(1.6)", offset: peak },
            { transform: "scale(1)", filter: "brightness(1)" },
          ],
          { duration: total, easing: EASE_OUT },
        );
        root.animate(
          [
            { "--fl-burst": 0 },
            { "--fl-burst": Math.min(1, 0.85 * strength), offset: peak },
            { "--fl-burst": 0 },
          ],
          { duration: total, easing: EASE_OUT },
        );
      },
    }),
    [reduced],
  );

  return (
    <div
      ref={rootRef}
      className="floodlight"
      data-effect="floodlight"
      data-motion={reduced ? "static" : "ambient"}
      aria-hidden="true"
      style={{ "--fl-intensity": intensity } as CSSProperties}
    >
      <div className="floodlight__beam" />
      <div ref={coneRef} className="floodlight__cone">
        <span className="floodlight__blob floodlight__blob--1" />
        <span className="floodlight__blob floodlight__blob--2" />
        <span className="floodlight__blob floodlight__blob--3" />
        <span className="floodlight__blob floodlight__blob--4" />
      </div>
      <div className="floodlight__pulse" />
    </div>
  );
}
