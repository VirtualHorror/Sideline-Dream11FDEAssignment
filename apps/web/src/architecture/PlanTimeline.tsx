/**
 * The build plan as a timeline (PLAN 9.4): one step per row of docs/PLAN.md's checklist, in order,
 * with its owner and status as the file has them (✅ rows are done). Read from the file at build time,
 * so the page cannot drift from the plan.
 *
 * Caller: pages/Architecture.tsx with the PLAN's text.
 */

export interface PlanTask {
  number: string;
  title: string;
  owner: string;
  status: string;
  done: boolean;
}

/** The rows of the PLAN's "## Checklist" table. */
export function planTasks(plan: string): PlanTask[] {
  const start = plan.indexOf("\n## Checklist");
  if (start === -1) return [];
  const lines = plan.slice(start + 1).split("\n");
  const end = lines.findIndex(
    (line, i) => i > 0 && (line.startsWith("## ") || line.startsWith("---")),
  );
  return lines
    .slice(0, end === -1 ? undefined : end)
    .filter((line) => /^\|\s*\d+\s*\|/.test(line))
    .map((line) => {
      const [number = "", title = "", owner = "", , status = ""] = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      return {
        number,
        title: title.replaceAll("`", ""),
        owner: owner.replaceAll("`", ""),
        status: status.replace(/^[✅⬜🟡]\s*/u, "").replaceAll("`", ""),
        done: status.startsWith("✅"),
      };
    });
}

export function PlanTimeline({ plan }: { plan: string }) {
  return (
    <ol className="timeline" aria-label="Build plan">
      {planTasks(plan).map((task) => (
        <li key={task.number} className="timeline__step" data-status={task.done ? "done" : "open"}>
          <span className="timeline__num">{task.number}</span>
          <div className="timeline__text">
            <p className="timeline__title">{task.title}</p>
            <p className="timeline__meta">
              {task.status || "to do"}. {task.owner}.
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
