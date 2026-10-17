/**
 * The cricket glossary (data/glossary.json): plain-English answers that need no model call.
 *
 * Callers: src/index.ts loads it once; the explainer path (ai/skills/explainer.ts) answers any
 * question that just names a term ("what is a free hit?") from here, as a `deterministic` moment
 * (Architecture §5). Matching is exact after normalisation, so a contextual question ("why is the
 * free hit such a big deal now?") goes to the model instead of getting a canned definition.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Lens } from "@sideline/engine";
import { z } from "zod";

const AnalogiesSchema = z.strictObject({
  analyst: z.string().min(1).max(200).optional(),
  f1: z.string().min(1).max(200).optional(),
  football: z.string().min(1).max(200).optional(),
  engineer: z.string().min(1).max(200).optional(),
});

const TermSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  term: z.string().min(1).max(40),
  aliases: z.array(z.string().min(1).max(40)),
  definition: z.string().min(1).max(380),
  analogies: AnalogiesSchema,
  related: z.array(z.string()).max(5),
});
export type GlossaryTerm = z.infer<typeof TermSchema>;

export const GlossaryFileSchema = z
  .strictObject({ version: z.literal(1), note: z.string(), terms: z.array(TermSchema).min(40) })
  .superRefine((file, ctx) => {
    const ids = new Set(file.terms.map((t) => t.id));
    if (ids.size !== file.terms.length) ctx.addIssue({ code: "custom", message: "duplicate ids" });
    const names = new Map<string, string>();
    for (const t of file.terms) {
      for (const related of t.related) {
        if (!ids.has(related)) {
          ctx.addIssue({ code: "custom", message: `${t.id} relates to unknown ${related}` });
        }
      }
      for (const name of [t.term, ...t.aliases]) {
        const key = normaliseQuestion(name);
        const owner = names.get(key);
        if (owner !== undefined && owner !== t.id) {
          ctx.addIssue({ code: "custom", message: `"${name}" names both ${owner} and ${t.id}` });
        }
        names.set(key, t.id);
      }
    }
  });

/** Words a question wraps around a bare term ("what does … mean", "explain the …"). */
const FILLER = new Set([
  "what",
  "whats",
  "is",
  "are",
  "a",
  "an",
  "the",
  "does",
  "do",
  "mean",
  "means",
  "meant",
  "by",
  "explain",
  "define",
  "definition",
  "of",
  "meaning",
  "tell",
  "me",
  "about",
  "please",
  "in",
  "cricket",
  "how",
  "work",
  "works",
]);

/** Lower case, apostrophes dropped, punctuation to spaces, filler words trimmed from both ends. */
export function normaliseQuestion(text: string): string {
  const words = text
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => word !== "");
  let start = 0;
  let end = words.length;
  while (start < end && FILLER.has(words[start] ?? "")) start += 1;
  while (end > start && FILLER.has(words[end - 1] ?? "")) end -= 1;
  return words.slice(start, end).join(" ");
}

export interface Glossary {
  terms: readonly GlossaryTerm[];
  /** The term a question names and nothing more, or null (then the model is asked). */
  lookup(question: string): GlossaryTerm | null;
  /** The longest glossary name the question mentions anywhere, for grounding a model answer. */
  mentioned(question: string): GlossaryTerm | null;
  /** The definition, plus the lens's analogy when the term has one. */
  answer(term: GlossaryTerm, lens: Lens): { answer: string; relatedTerms: string[] };
}

export function createGlossary(file: z.infer<typeof GlossaryFileSchema>): Glossary {
  const byName = new Map<string, GlossaryTerm>();
  const byId = new Map(file.terms.map((t) => [t.id, t]));
  for (const t of file.terms) {
    for (const name of [t.term, ...t.aliases]) byName.set(normaliseQuestion(name), t);
  }
  return {
    terms: file.terms,
    lookup: (question) => byName.get(normaliseQuestion(question)) ?? null,
    mentioned(question) {
      const padded = ` ${normaliseQuestion(question)} `;
      let best: { name: string; term: GlossaryTerm } | null = null;
      for (const [name, term] of byName) {
        if (name !== "" && padded.includes(` ${name} `) && name.length > (best?.name.length ?? 0)) {
          best = { name, term };
        }
      }
      return best?.term ?? null;
    },
    answer(term, lens) {
      const analogy = lens === "casual" ? undefined : term.analogies[lens];
      return {
        answer: analogy ? `${term.definition} ${analogy}` : term.definition,
        relatedTerms: term.related.map((id) => byId.get(id)?.term ?? id),
      };
    },
  };
}

export function loadGlossary(dataDir: string): Glossary {
  const raw: unknown = JSON.parse(readFileSync(join(dataDir, "glossary.json"), "utf8"));
  const parsed = GlossaryFileSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`data: glossary.json is invalid: ${parsed.error.message}`);
  return createGlossary(parsed.data);
}
