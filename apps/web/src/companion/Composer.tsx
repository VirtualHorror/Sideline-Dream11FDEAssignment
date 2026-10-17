/**
 * "Ask Sideline": the companion's question box (GlowInput) with a suggestion from the match state and
 * the API's limits said plainly: 280 characters, and a few questions at a time (429 with Retry-After).
 * Caller: pages/MatchRoom.tsx, which sends the question and owns the thinking state.
 */
import { GlowInput } from "../effects/GlowInput.tsx";

export function Composer({
  suggestion,
  thinking,
  error,
  disabled,
  onAsk,
}: {
  suggestion: string;
  thinking: boolean;
  error: string | null;
  disabled: boolean;
  onAsk(text: string): void;
}) {
  return (
    <div className="composer">
      {error ? (
        <p className="composer__error" role="alert">
          {error}
        </p>
      ) : null}
      <GlowInput
        state={thinking ? "thinking" : "idle"}
        label="Ask Sideline"
        suggestion={suggestion}
        disabled={disabled}
        onSubmit={onAsk}
      />
    </div>
  );
}
