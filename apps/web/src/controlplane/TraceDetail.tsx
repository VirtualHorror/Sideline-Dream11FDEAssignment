/**
 * One AI trace, expanded: the AICallTrace row as recorded and, when the fan has the card it produced,
 * that card's payload, as JSON. Caller: controlplane/TraceList.tsx (only for traces already visible on
 * the fan's TV clock, so the payload can never be a spoiler).
 */
import type { AICallTrace } from "@sideline/engine";
import { useId, useState } from "react";

export function TraceDetail({ trace, payload }: { trace: AICallTrace; payload: unknown }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="trace-detail">
      <button
        type="button"
        className="link-button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "Hide the JSON" : "Show the JSON"}
      </button>
      {open ? (
        <pre id={id} className="trace-detail__json" aria-label="Trace JSON" tabIndex={0}>
          {JSON.stringify({ trace, payload }, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}
