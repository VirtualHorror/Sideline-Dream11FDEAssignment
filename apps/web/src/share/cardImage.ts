/**
 * Draws a banter card as a square PNG for the fan to share with their friends' league (PLAN Task 9):
 * the night-match picture of the TV screen, the card's tone, headline and body, and the app's name.
 * The words are the card's own (the model's, or the labelled template's); nothing is added but the
 * frame.
 *
 * Caller: companion/cards/BanterCard.tsx. Returns null where the browser cannot draw (no 2D canvas):
 * the card then shares its text instead.
 */
import type { BailoutPayload } from "@sideline/engine";

type Banter = BailoutPayload["banter"];

const SIZE = 1080;
const PAD = 96;
/** The TV screen's night palette (styles/tokens.css, dark): the image looks the same in either theme. */
const NIGHT = "#080b14";
const NIGHT_2 = "#141c30";
const INK = "#f4f2fc";
const MUTED = "#a2abc6";
const CYAN = "#69b9ec";
const PINK = "#d165aa";
const FONT = '"Anek Latin Variable", "Anek Latin", system-ui, sans-serif';

export const TONE_LABELS: Record<Banter["tone"], string> = {
  self_roast: "Self-roast",
  savage: "Savage",
  wholesome: "Wholesome",
};

/** Greedy word wrap to `width`, at most `lines` lines (the last one ends in an ellipsis if cut). */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, lines: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= width || line === "") {
      line = next;
      continue;
    }
    out.push(line);
    line = word;
    if (out.length === lines) break;
  }
  if (out.length < lines && line) out.push(line);
  if (out.length === lines && out.join(" ").length < text.length) {
    out[lines - 1] = `${(out[lines - 1] ?? "").replace(/\s+\S*$/, "")}…`;
  }
  return out;
}

export async function renderCardPng(
  banter: Banter,
  makeCanvas: () => HTMLCanvasElement = () => document.createElement("canvas"),
): Promise<Blob | null> {
  const canvas = makeCanvas();
  canvas.width = SIZE;
  canvas.height = SIZE;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext("2d");
  } catch {
    ctx = null;
  }
  if (!ctx) return null;

  const sky = ctx.createLinearGradient(0, 0, 0, SIZE);
  sky.addColorStop(0, NIGHT);
  sky.addColorStop(1, NIGHT_2);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, SIZE, SIZE);
  // The floodlight rising from the bottom edge, as on the TV screen.
  const light = ctx.createRadialGradient(
    SIZE / 2,
    SIZE * 1.1,
    40,
    SIZE / 2,
    SIZE * 1.1,
    SIZE * 0.8,
  );
  light.addColorStop(0, `${CYAN}88`);
  light.addColorStop(0.5, `${PINK}33`);
  light.addColorStop(1, `${NIGHT}00`);
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, SIZE, SIZE);

  ctx.textBaseline = "top";
  ctx.fillStyle = MUTED;
  ctx.font = `600 40px ${FONT}`;
  ctx.fillText(TONE_LABELS[banter.tone], PAD, PAD);
  ctx.fillStyle = INK;
  ctx.font = `700 92px ${FONT}`;
  let y = PAD + 90;
  for (const line of wrap(ctx, banter.headline, SIZE - PAD * 2, 3)) {
    ctx.fillText(line, PAD, y);
    y += 104;
  }
  ctx.font = `500 46px ${FONT}`;
  y += 32;
  for (const line of wrap(ctx, banter.body, SIZE - PAD * 2, 5)) {
    ctx.fillText(line, PAD, y);
    y += 60;
  }
  ctx.fillStyle = MUTED;
  ctx.font = `600 38px ${FONT}`;
  ctx.fillText("Sideline, a second screen for live cricket", PAD, SIZE - PAD - 38);

  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
}
