/**
 * DitherVeil (Effect C, WebGL2 with a CSS fallback): the dot-matrix veil over anything held back.
 * Meaning: "held back" (a spoiler waiting for the fan's TV) and, pulsing, "thinking".
 *
 * Callers: companion/cards/SpoilerCard.tsx (intensity 1 while held; 0 when the TV reaches the ball,
 * which dissolves the veil over 900 ms), CatchUpReel.tsx and companion/Composer.tsx (`pulse` while a
 * reel or an answer is on its way: 0.15-0.35 over 2.5 s). The veil covers its positioned parent and
 * is `aria-hidden`; what it hides is not in the DOM until it may be shown (SpoilerCard), so the veil
 * is decoration, never the only guard.
 *
 * A WebGL context exists only while the veil is visible (holding, dissolving or pulsing) and is
 * released when it settles at 0, so a feed full of revealed cards holds no GPU contexts. Without
 * WebGL2, or with reduced motion, a CSS dot pattern fades instead (150 ms under reduced motion).
 */
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { DITHER_FRAGMENT } from "./dither.glsl.ts";
import {
  activateProgram,
  createGlCanvas,
  createProgram,
  cssColorToRgb,
  FULLSCREEN_VERTEX,
  fullscreenTriangle,
  pixelRatio,
  releaseGl,
  useOnScreen,
  useReducedMotion,
  webgl2Supported,
} from "./webgl.ts";

const DISSOLVE_MS = 900;
const RISE_MS = 200;
const PULSE_PERIOD_MS = 2500;
const DOT_CSS_PX = 3;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** The pulse envelope: 0.15-0.35 over 2.5 s. */
const pulseAt = (ms: number) => 0.25 + 0.1 * Math.sin((ms / PULSE_PERIOD_MS) * Math.PI * 2);

export function DitherVeil({
  intensity,
  reducedMotion,
  pulse = false,
  className,
}: {
  intensity: number;
  reducedMotion?: boolean;
  /** "Thinking": pulse at low intensity instead of holding `intensity`. */
  pulse?: boolean;
  className?: string;
}) {
  const preferred = useReducedMotion();
  const reduced = reducedMotion ?? preferred;
  const target = clamp01(intensity);
  const hostRef = useRef<HTMLDivElement>(null);
  const onScreen = useOnScreen(hostRef);
  const [render, setRender] = useState<"css" | "webgl">("css");
  // The GL loop reads the latest props through refs, so prop changes never rebuild the context.
  const targetRef = useRef(target);
  targetRef.current = target;
  const pulseRef = useRef(pulse);
  pulseRef.current = pulse;
  const onScreenRef = useRef(onScreen);
  onScreenRef.current = onScreen;
  const [active, setActive] = useState(target > 0 || pulse);

  useEffect(() => {
    if (target > 0 || pulse) setActive(true);
  }, [target, pulse]);

  useEffect(() => {
    const host = hostRef.current;
    if (!active || reduced || !host || !webgl2Supported()) return;
    const made = createGlCanvas();
    if (!made) return;
    const { canvas, gl } = made;
    let program: WebGLProgram;
    try {
      program = createProgram(gl, FULLSCREEN_VERTEX, DITHER_FRAGMENT);
    } catch (error) {
      console.warn("[sideline] DitherVeil falls back to CSS:", error);
      releaseGl(gl);
      return;
    }
    const vao = fullscreenTriangle(gl);
    const at = (name: string) => gl.getUniformLocation(program, name);
    const u = {
      resolution: at("uResolution"),
      time: at("uTime"),
      intensity: at("uIntensity"),
      pixel: at("uPixel"),
      dpr: at("uDpr"),
      ink: at("uInk"),
      base: at("uBase"),
      seed: at("uSeed"),
    };
    canvas.className = "veil__canvas";
    host.appendChild(canvas);
    setRender("webgl");

    let ink = cssColorToRgb("#a2abc6");
    let base = cssColorToRgb("#141c30");
    const readColors = () => {
      const style = getComputedStyle(host);
      ink = cssColorToRgb(style.getPropertyValue("--veil-ink"));
      base = cssColorToRgb(style.getPropertyValue("--veil-base"));
    };
    readColors();
    const resize = () => {
      const dpr = pixelRatio();
      canvas.width = Math.max(1, Math.round(host.clientWidth * dpr));
      canvas.height = Math.max(1, Math.round(host.clientHeight * dpr));
    };
    resize();
    const resizer = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
    resizer?.observe(host);

    const seed = Math.random() * 50;
    const start = performance.now();
    let current = pulseRef.current ? pulseAt(0) : targetRef.current;
    let last = start;
    let frame = 0;
    let raf = 0;
    const draw = (value: number, now: number) => {
      const dpr = pixelRatio();
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      activateProgram(gl, program);
      gl.uniform2f(u.resolution, canvas.width, canvas.height);
      gl.uniform1f(u.time, (now - start) / 1000);
      gl.uniform1f(u.intensity, value);
      gl.uniform1f(u.pixel, DOT_CSS_PX * dpr);
      gl.uniform1f(u.dpr, dpr);
      gl.uniform3f(u.ink, ink[0], ink[1], ink[2]);
      gl.uniform3f(u.base, base[0], base[1], base[2]);
      gl.uniform1f(u.seed, seed);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const loop = (now: number) => {
      const dt = now - last;
      last = now;
      frame += 1;
      if (frame % 60 === 0) readColors();
      const goal = targetRef.current;
      if (pulseRef.current) {
        current = pulseAt(now - start);
      } else if (goal < current) {
        current = Math.max(goal, current - dt / DISSOLVE_MS);
      } else {
        current = Math.min(goal, current + dt / RISE_MS);
      }
      if (onScreenRef.current) draw(current, now);
      if (!pulseRef.current && goal === 0 && current === 0) {
        setActive(false);
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      resizer?.disconnect();
      canvas.remove();
      releaseGl(gl);
      setRender("css");
    };
  }, [active, reduced]);

  return (
    <div
      ref={hostRef}
      className={className ? `veil ${className}` : "veil"}
      data-effect="veil"
      data-render={render}
      data-motion={reduced ? "reduced" : "full"}
      data-pulse={pulse ? "true" : undefined}
      data-intensity={String(target)}
      aria-hidden="true"
      style={{ "--veil": pulse ? 0.3 : target } as CSSProperties}
    />
  );
}
