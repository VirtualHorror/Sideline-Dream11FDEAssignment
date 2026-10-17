/**
 * GhostText (Effect B, WebGL2 with a CSS fallback): display text that splits into colour fringes
 * where a pointer moves through it, decaying in about half a second. Meaning: the moment itself.
 *
 * Callers: pages/Landing.tsx (the wordmark, `mode="pointer"`) and broadcast/TvPane.tsx (the reveal
 * headline for a big ball or the result, `mode="sweep"`: a synthetic pointer crosses it once when it
 * mounts, which TvPane does only when the moment is revealed on the fan's TV clock).
 *
 * The real text stays in the DOM (accessible, selectable) and is only made transparent once the
 * canvas has drawn its first frame. The canvas copy is drawn with the element's computed font into
 * a texture; the shaders are in ghost.glsl.ts. The frame loop runs only while the trail has energy,
 * and the context is released on unmount. Fallback (no WebGL2, reduced motion, or no context): the
 * plain text with a static one-pixel red/cyan fringe in CSS.
 */
import { createElement, useEffect, useRef, useState } from "react";
import { GHOST_FRAGMENT, TRAIL_FRAGMENT } from "./ghost.glsl.ts";
import {
  activateProgram,
  createGlCanvas,
  createProgram,
  cssColorToRgb,
  FULLSCREEN_VERTEX,
  fullscreenTriangle,
  pixelRatio,
  releaseGl,
  useReducedMotion,
  webgl2Supported,
} from "./webgl.ts";

const DECAY = 0.92;
const TRAIL_WIDTH = 64;
const SPLAT_RADIUS = 0.08;
/** Velocity is pointer travel per frame as a share of the text's width, times this gain. */
const VELOCITY_GAIN = 24;
const VELOCITY_LIMIT = 1.5;
const VELOCITY_INPUT = 0.12;
const STRENGTH = 0.5;
const SWEEP_MS = 900;
/** The canvas extends past the glyphs so fringes are not clipped. */
const PAD_X = 0.06;
const PAD_Y = 0.3;

/** Canvas `fontStretch` takes keywords; CSS gives a percentage. */
function stretchKeyword(stretch: string): CanvasFontStretch {
  const pct = stretch.endsWith("%") ? Number.parseFloat(stretch) : 100;
  const steps: [number, CanvasFontStretch][] = [
    [50, "ultra-condensed"],
    [62.5, "extra-condensed"],
    [75, "condensed"],
    [87.5, "semi-condensed"],
    [100, "normal"],
    [112.5, "semi-expanded"],
    [125, "expanded"],
    [150, "extra-expanded"],
    [200, "ultra-expanded"],
  ];
  let best = steps[4] as [number, CanvasFontStretch];
  for (const step of steps) if (Math.abs(step[0] - pct) < Math.abs(best[0] - pct)) best = step;
  return best[1];
}

function trailTarget(gl: WebGL2RenderingContext, width: number, height: number, half: boolean) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  if (half) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  return { texture, framebuffer };
}

export function GhostText({
  text,
  as = "span",
  mode,
  className,
}: {
  text: string;
  as?: "h1" | "span";
  mode: "pointer" | "sweep";
  className?: string;
}) {
  const reduced = useReducedMotion();
  const hostRef = useRef<HTMLElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const holderRef = useRef<HTMLSpanElement>(null);
  const [render, setRender] = useState<"css" | "webgl">("css");

  useEffect(() => {
    const host = hostRef.current;
    const textEl = textRef.current;
    const holder = holderRef.current;
    if (reduced || !host || !textEl || !holder || !webgl2Supported()) return;
    const made = createGlCanvas();
    if (!made) return;
    const { canvas, gl } = made;
    let trailProgram: WebGLProgram;
    let ghostProgram: WebGLProgram;
    try {
      trailProgram = createProgram(gl, FULLSCREEN_VERTEX, TRAIL_FRAGMENT);
      ghostProgram = createProgram(gl, FULLSCREEN_VERTEX, GHOST_FRAGMENT);
    } catch (error) {
      console.warn("[sideline] GhostText falls back to CSS:", error);
      releaseGl(gl);
      return;
    }
    const half = gl.getExtension("EXT_color_buffer_float") !== null;
    const vao = fullscreenTriangle(gl);
    const trailU = (name: string) => gl.getUniformLocation(trailProgram, name);
    const ghostU = (name: string) => gl.getUniformLocation(ghostProgram, name);
    const textTexture = gl.createTexture();
    let targets = [trailTarget(gl, TRAIL_WIDTH, 8, half), trailTarget(gl, TRAIL_WIDTH, 8, half)];
    let trailHeight = 8;
    let cssW = 1;
    let cssH = 1;
    let cancelled = false;
    let raf = 0;
    let running = false;
    let energy = 0;
    let shown = false;
    // Pointer state in canvas UV (y up) and the travel since the last frame, in CSS px.
    let pointer = { u: -1, v: -1 };
    let travel = { x: 0, y: 0 };
    let sweepStart = -1;

    const clearTrail = () => {
      const neutral = half ? 0 : 0.5;
      for (const target of targets) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
        gl.viewport(0, 0, TRAIL_WIDTH, trailHeight);
        gl.clearColor(neutral, neutral, neutral, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
    };

    const layout = () => {
      const rect = textEl.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      const style = getComputedStyle(textEl);
      const padX = Math.round(rect.width * PAD_X);
      const padY = Math.round(rect.height * PAD_Y);
      cssW = rect.width + padX * 2;
      cssH = rect.height + padY * 2;
      const dpr = pixelRatio();
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      Object.assign(canvas.style, {
        width: `${cssW}px`,
        height: `${cssH}px`,
        left: `${-padX}px`,
        top: `${-padY}px`,
      });
      const scratch = document.createElement("canvas");
      scratch.width = canvas.width;
      scratch.height = canvas.height;
      const ctx = scratch.getContext("2d");
      if (!ctx) return false;
      ctx.scale(dpr, dpr);
      ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      ctx.fontStretch = stretchKeyword(style.fontStretch);
      if (style.letterSpacing !== "normal") ctx.letterSpacing = style.letterSpacing;
      ctx.fillStyle = "#fff";
      ctx.textBaseline = "alphabetic";
      const metrics = ctx.measureText(text);
      const ascent = metrics.fontBoundingBoxAscent;
      const descent = metrics.fontBoundingBoxDescent;
      const baseline = padY + (rect.height - (ascent + descent)) / 2 + ascent;
      ctx.fillText(text, padX, baseline);
      gl.bindTexture(gl.TEXTURE_2D, textTexture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, scratch);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const nextHeight = Math.max(4, Math.round((TRAIL_WIDTH * cssH) / cssW));
      if (nextHeight !== trailHeight) {
        trailHeight = nextHeight;
        targets = [
          trailTarget(gl, TRAIL_WIDTH, trailHeight, half),
          trailTarget(gl, TRAIL_WIDTH, trailHeight, half),
        ];
      }
      clearTrail();
      return true;
    };

    const composite = () => {
      const light = document.documentElement.dataset.theme === "light";
      const ink = cssColorToRgb(getComputedStyle(textEl).color);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      activateProgram(gl, ghostProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, textTexture);
      gl.uniform1i(ghostU("uText"), 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, targets[0]?.texture ?? null);
      gl.uniform1i(ghostU("uTrail"), 1);
      gl.uniform1i(ghostU("uEncoded"), half ? 0 : 1);
      gl.uniform1f(ghostU("uStrength"), STRENGTH);
      gl.uniform3f(ghostU("uInk"), ink[0], ink[1], ink[2]);
      gl.uniform1i(ghostU("uLight"), light ? 1 : 0);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!shown) {
        shown = true;
        setRender("webgl");
      }
    };

    const step = (now: number) => {
      if (sweepStart >= 0) {
        const p = (now - sweepStart) / SWEEP_MS;
        if (p >= 1) {
          sweepStart = -1;
        } else {
          const next = { u: -0.05 + 1.1 * p, v: 0.5 + 0.2 * Math.sin(p * Math.PI * 3) };
          if (pointer.u >= -0.5) {
            travel.x += (next.u - pointer.u) * cssW;
            travel.y += (pointer.v - next.v) * cssH;
          }
          pointer = next;
        }
      }
      const moved = Math.hypot(travel.x, travel.y);
      const limit = (x: number) => Math.max(-VELOCITY_LIMIT, Math.min(VELOCITY_LIMIT, x));
      const velocity = [
        limit((travel.x / cssW) * VELOCITY_GAIN),
        limit((-travel.y / cssW) * VELOCITY_GAIN),
      ];
      const input = moved > 0 ? Math.min(1, (moved / cssW) * 20) : 0;
      travel = { x: 0, y: 0 };

      const [from, to] = targets as [
        ReturnType<typeof trailTarget>,
        ReturnType<typeof trailTarget>,
      ];
      gl.bindFramebuffer(gl.FRAMEBUFFER, to.framebuffer);
      gl.viewport(0, 0, TRAIL_WIDTH, trailHeight);
      activateProgram(gl, trailProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, from.texture);
      gl.uniform1i(trailU("uPrev"), 0);
      gl.uniform2f(trailU("uPointer"), pointer.u, pointer.v);
      gl.uniform2f(
        trailU("uVelocity"),
        (velocity[0] ?? 0) * VELOCITY_INPUT,
        (velocity[1] ?? 0) * VELOCITY_INPUT,
      );
      gl.uniform1f(trailU("uEnergy"), input);
      gl.uniform1f(trailU("uAspect"), cssH / cssW);
      gl.uniform1f(trailU("uRadius"), SPLAT_RADIUS);
      gl.uniform1f(trailU("uDecay"), DECAY);
      gl.uniform1i(trailU("uEncoded"), half ? 0 : 1);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      targets = [to, from];
      composite();

      energy = energy * DECAY + input;
      if (energy < 0.001 && sweepStart < 0) {
        running = false;
        clearTrail();
        composite();
        return;
      }
      raf = requestAnimationFrame(step);
    };

    const wake = () => {
      if (running || cancelled || document.visibilityState === "hidden") return;
      running = true;
      raf = requestAnimationFrame(step);
    };

    const onMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const next = {
        u: (event.clientX - rect.left) / rect.width,
        v: 1 - (event.clientY - rect.top) / rect.height,
      };
      if (pointer.u >= -0.5) {
        travel.x += (next.u - pointer.u) * cssW;
        travel.y += (pointer.v - next.v) * cssH;
      }
      pointer = next;
      wake();
    };
    const onLeave = () => {
      pointer = { u: -1, v: -1 };
    };

    holder.appendChild(canvas);
    canvas.className = "ghost__canvas";
    const start = () => {
      if (cancelled || !layout()) return;
      composite();
      if (mode === "sweep") {
        sweepStart = performance.now();
        energy = 1;
        wake();
      }
    };
    const fontsReady = document.fonts?.ready ?? Promise.resolve();
    void fontsReady.then(start);
    if (mode === "pointer") {
      host.addEventListener("pointermove", onMove);
      host.addEventListener("pointerleave", onLeave);
    }
    const resizer =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(() => {
            if (shown && layout()) composite();
          })
        : null;
    resizer?.observe(textEl);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        cancelAnimationFrame(raf);
        running = false;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      resizer?.disconnect();
      canvas.remove();
      releaseGl(gl);
      setRender("css");
    };
  }, [reduced, mode, text]);

  return createElement(
    as,
    {
      ref: hostRef,
      className: className ? `ghost ${className}` : "ghost",
      "data-effect": "ghost",
      "data-render": render,
    },
    <span ref={textRef} className="ghost__text">
      {text}
    </span>,
    <span ref={holderRef} className="ghost__gl" aria-hidden="true" />,
  );
}
