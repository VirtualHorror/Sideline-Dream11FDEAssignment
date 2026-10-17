/**
 * `/architecture` (D-034): a shareable page for the demo round that shows how Sideline is built,
 * rendered at build time from the repository's own docs (Vite `?raw` imports), so it can never drift
 * from them: docs/Architecture.md in full, the docs/PLAN.md checklist (task status), and every entry
 * of docs/Decisions.md, each collapsible. No prose of its own: a sentence the page needs belongs in
 * the docs. Task 9 adds the pipeline diagram and the live "when we don't call AI" table above.
 *
 * Caller: App.tsx, loaded on demand.
 */
import architectureText from "../../../../docs/Architecture.md?raw";
import decisionsText from "../../../../docs/Decisions.md?raw";
import planText from "../../../../docs/PLAN.md?raw";
import { renderMarkdown } from "../lib/markdown.ts";

/** The PLAN's "## Checklist" section: its table of tasks, owners, branches and status. */
function checklist(plan: string): string {
  const start = plan.indexOf("\n## Checklist");
  if (start === -1) return "";
  const body = plan
    .slice(start + 1)
    .split("\n")
    .slice(1);
  const end = body.findIndex((line) => line.startsWith("## ") || line.startsWith("---"));
  return body.slice(0, end === -1 ? undefined : end).join("\n");
}

/** Decisions.md split into its preamble and one `{ id, title, body }` per "### D-NNN" entry. */
function decisions(text: string) {
  const parts = text.split(/^(?=### D-\d{3})/m);
  const preamble = parts[0] ?? "";
  const entries = parts.slice(1).map((part) => {
    const [heading = "", ...rest] = part.split("\n");
    const title = heading.replace(/^### /, "").trim();
    return { id: title.match(/^D-\d{3}/)?.[0] ?? title, title, body: rest.join("\n") };
  });
  return { preamble, entries };
}

const SECTIONS = [
  { id: "architecture", label: "Architecture" },
  { id: "plan", label: "Build plan" },
  { id: "decisions", label: "Decisions" },
] as const;

export function Architecture() {
  const { preamble, entries } = decisions(decisionsText);
  return (
    <div className="docs">
      <nav className="docs__nav" aria-label="On this page">
        <ol className="docs__nav-list">
          {SECTIONS.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`}>{section.label}</a>
            </li>
          ))}
        </ol>
      </nav>
      <article className="docs__body md" id="architecture">
        {renderMarkdown(architectureText, "architecture")}
      </article>
      <section className="docs__section md" id="plan" aria-label="Build plan">
        <h2>Build plan</h2>
        {renderMarkdown(checklist(planText), "plan")}
      </section>
      <section className="docs__section md" id="decisions" aria-label="Decisions">
        <h2>Decisions</h2>
        {renderMarkdown(preamble.replace(/^# .*\n/, ""), "decisions-intro")}
        <div className="decisions">
          {entries.map((entry) => (
            <details key={entry.id} className="decision" data-decision={entry.id}>
              <summary className="decision__summary">{entry.title}</summary>
              <div className="decision__body">{renderMarkdown(entry.body, entry.id)}</div>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
