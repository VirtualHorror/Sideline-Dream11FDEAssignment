/**
 * JSON request bodies: size-capped, parsed and validated, with the API's error shape.
 *
 * Called by the POST routes (sessions, control, ask). The cap is enforced while reading, so a
 * chunked upload without a Content-Length cannot make the server buffer it whole (Review focus 5).
 * A 10,000-character question still fits under the cap and is refused by its schema with 400; a
 * body over the cap is 413.
 */
import type { Context } from "hono";
import type { z } from "zod";

export const MAX_JSON_BYTES = 16 * 1024;

/** `{ error: { code, message } }`, the API's one error shape (see http/app.ts). */
export function jsonError(
  c: Context,
  status: 400 | 404 | 409 | 413 | 429 | 503,
  code: string,
  message: string,
): Response {
  return c.json({ error: { code, message } }, status);
}

async function readCapped(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function readJson<T>(
  c: Context,
  schema: z.ZodType<T>,
  maxBytes = MAX_JSON_BYTES,
): Promise<{ ok: true; value: T } | { ok: false; response: Response }> {
  const text = await readCapped(c.req.raw, maxBytes);
  if (text === null) {
    return {
      ok: false,
      response: jsonError(c, 413, "payload_too_large", `request body over ${maxBytes} bytes`),
    };
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return {
      ok: false,
      response: jsonError(c, 400, "invalid_request", "request body is not valid JSON"),
    };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "(body)"}: ${issue.message}`)
      .join("; ");
    return { ok: false, response: jsonError(c, 400, "invalid_request", message) };
  }
  return { ok: true, value: parsed.data };
}
