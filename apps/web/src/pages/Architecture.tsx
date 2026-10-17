/**
 * `/architecture` (D-034): a shareable page for the demo round that shows how Sideline is built,
 * rendered at build time from the repository's own docs (Vite `?raw` imports), so it can never drift
 * from them: docs/Architecture.md in full, the docs/PLAN.md checklist (task status), and every entry
 * of docs/Decisions.md, each collapsible. No prose of its own: a sentence the page needs belongs in
 * the docs. Above them (Task 9): the three design theses (Architecture.md's own section), the
 * pipeline as one picture, the live "when we don't call AI" table (global telemetry), the plan as a
 * timeline, and the credits and licences (README.md's own section).
 *
 * Caller: App.tsx, loaded on demand.
 */
import type { TelemetrySnapshot } from "@sideline/engine";
import architectureText from "../../../../docs/Architecture.md?raw";
import decisionsText from "../../../../docs/Decisions.md?raw";
import planText from "../../../../docs/PLAN.md?raw";
import readmeText from "../../../../README.md?raw";
import { AiUsageTable } from "../architecture/AiUsageTable.tsx";
import { PipelineDiagram } from "../architecture/PipelineDiagram.tsx";
import { PlanTimeline } from "../architecture/PlanTimeline.tsx";
import { api } from "../lib/api.ts";
import { renderMarkdown } from "../lib/markdown.ts";

/** The body of a markdown section: from its heading line to the next heading of `level` or above. */
function section(text: string, heading: RegExp, level: number): string {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) return "";
  const stop = new RegExp(`^#{1,${level}} `);
  const end = lines.findIndex((line, i) => i > start && stop.test(line));
  return lines.slice(start + 1, end === -1 ? undefined : end).join("\n");
}

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
  { id: "theses", label: "Theses" },
  { id: "pipeline", label: "Pipeline" },
  { id: "ai-usage", label: "AI use, live" },
  { id: "timeline", label: "Timeline" },
  { id: "architecture", label: "Architecture" },
  { id: "plan", label: "Build plan" },
  { id: "decisions", label: "Decisions" },
  { id: "credits", label: "Credits" },
] as const;

export function Architecture({
  loadTelemetry = api.globalTelemetry,
}: {
  loadTelemetry?: () => Promise<TelemetrySnapshot>;
}) {
  const { preamble, entries } = decisions(decisionsText);
  // The ending markers of each section: the theses end at the next "##", the credits before the line
  // that closes the README.
  const theses = section(architectureText, /^### Three design theses/, 3);
  const credits = section(readmeText, /^## Credits and licences/, 2).split("\nMade with")[0] ?? "";
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
      <section className="docs__section md" id="theses" aria-label="Three design theses">
        <h2>Three design theses</h2>
        {renderMarkdown(theses, "theses")}
      </section>
      <section className="docs__section" id="pipeline" aria-label="Pipeline">
        <h2 className="docs__h2">The pipeline</h2>
        <PipelineDiagram />
      </section>
      <section className="docs__section" id="ai-usage" aria-label="AI use, live">
        <h2 className="docs__h2">When Sideline does not call AI, live</h2>
        <AiUsageTable load={loadTelemetry} />
      </section>
      <section className="docs__section" id="timeline" aria-label="Timeline">
        <h2 className="docs__h2">How it was built</h2>
        <PlanTimeline plan={planText} />
      </section>
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
      <section className="docs__section md" id="credits" aria-label="Credits and licences">
        <h2>Credits and licences</h2>
        {renderMarkdown(credits, "credits")}
      </section>
    </div>
  );
}
