/**
 * Shared plumbing for the two WebGL2 effects (GhostText, DitherVeil) and the motion preference that
 * every effect honours (docs/design/VISUAL_REFERENCES.md, "Global rules for all effects").
 *
 * Callers: effects/*.tsx. Each WebGL effect starts on its CSS fallback and upgrades itself only when
 * WebGL2 exists, the fan has not asked for reduced motion, and the browser actually hands over a
 * context (it may refuse: blocked GPU, too many live contexts). Contexts are created lazily, the
 * device-pixel ratio is capped at 2, frame loops pause while the tab is hidden or the element is off
 * screen, and every context is released when its component no longer needs it.
 */
import { type RefObject, useEffect, useState } from "react";

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const DPR_CAP = 2;

export function prefersReducedMotion(): boolean {
  try {
    return typeof window.matchMedia === "function"
      ? window.matchMedia(REDUCED_MOTION_QUERY).matches
      : false;
  } catch {
    return false;
  }
}

/** The fan's reduced-motion preference, following live changes. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(REDUCED_MOTION_QUERY);
    const onChange = () => setReduced(media.matches);
    media.addEventListener?.("change", onChange);
    return () => media.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

export function webgl2Supported(): boolean {
  return typeof WebGL2RenderingContext !== "undefined";
}

/** A WebGL2 context on a fresh canvas, or null when the browser will not give one. */
export function createGlCanvas(): { canvas: HTMLCanvasElement; gl: WebGL2RenderingContext } | null {
  const canvas = document.createElement("canvas");
  try {
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "low-power",
    });
    return gl ? { canvas, gl } : null;
  } catch {
    return null;
  }
}

export function releaseGl(gl: WebGL2RenderingContext): void {
  gl.getExtension("WEBGL_lose_context")?.loseContext();
}

export function pixelRatio(): number {
  return Math.min(window.devicePixelRatio || 1, DPR_CAP);
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("WebGL: cannot create a shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`WebGL: shader failed to compile: ${log}`);
  }
  return shader;
}

/** Compiles and links a program; throws with the driver's log so a broken shader is loud. */
export function createProgram(
  gl: WebGL2RenderingContext,
  vertex: string,
  fragment: string,
): WebGLProgram {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragment));
  gl.bindAttribLocation(program, 0, "aPos");
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`WebGL: program failed to link: ${gl.getProgramInfoLog(program)}`);
  }
  return program;
}

/**
 * `gl.useProgram`, renamed: React's hook linter reads any `use…` call inside a component as a hook,
 * and the effects call this from their frame loops.
 */
export function activateProgram(gl: WebGL2RenderingContext, program: WebGLProgram): void {
  // biome-ignore lint/correctness/useHookAtTopLevel: WebGL's useProgram, not a React hook
  gl.useProgram(program);
}

/** One triangle that covers the viewport; attribute 0 (`aPos`) in clip space. */
export function fullscreenTriangle(gl: WebGL2RenderingContext): WebGLVertexArrayObject {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return vao;
}

export const FULLSCREEN_VERTEX = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

/** A CSS colour as linear-ish 0-1 RGB for a uniform (sRGB values, as the canvas composites them). */
export function cssColorToRgb(color: string): [number, number, number] {
  const hex = color.trim().match(/^#([0-9a-f]{6})$/i)?.[1];
  if (hex) {
    const n = Number.parseInt(hex, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  const rgb = color.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (rgb) return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255];
  return [1, 1, 1];
}

/**
 * Whether an element is worth animating: the tab is visible and the element is on screen.
 * Without IntersectionObserver (jsdom, old browsers) it counts as on screen.
 */
export function useOnScreen(ref: RefObject<Element | null>): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const element = ref.current;
    let intersecting = true;
    const update = () => setVisible(intersecting && document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    let observer: IntersectionObserver | null = null;
    if (element && typeof IntersectionObserver === "function") {
      observer = new IntersectionObserver((entries) => {
        intersecting = entries.some((entry) => entry.isIntersecting);
        update();
      });
      observer.observe(element);
    }
    update();
    return () => {
      document.removeEventListener("visibilitychange", update);
      observer?.disconnect();
    };
  }, [ref]);
  return visible;
}
