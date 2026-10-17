/**
 * GlowInput (Effect D, CSS): every box where the fan talks to the AI wears a soft multicolour halo,
 * brighter on focus and turning while an answer is on its way. Meaning: you are talking to the AI.
 *
 * Callers: companion/Composer.tsx ("Ask Sideline"); Task 9 adds the lineup intent and inspector
 * boxes. The suggestion is computed by the caller from the match state (never by a model); Tab
 * accepts it while the box is empty, and with text in the box Tab moves focus as usual. The halo (a
 * blurred conic gradient behind the shell), its rotation and the reduced-motion rule live in
 * styles/effects.css; `data-state` carries the state.
 */
import { type FormEvent, type KeyboardEvent, useId, useState } from "react";

/** The API takes 1-280 characters (D-058). */
export const MAX_QUESTION_CHARS = 280;

export function GlowInput({
  state,
  suggestion,
  onSubmit,
  label,
  disabled = false,
}: {
  state: "idle" | "thinking";
  suggestion?: string;
  onSubmit(text: string): void;
  label: string;
  disabled?: boolean;
}) {
  const id = useId();
  const [value, setValue] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = value.trim();
    if (text.length === 0 || disabled) return;
    onSubmit(text);
    setValue("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Tab" && !event.shiftKey && value === "" && suggestion) {
      event.preventDefault();
      setValue(suggestion);
    }
  };

  return (
    <form className="glow-input" data-effect="glow-input" data-state={state} onSubmit={submit}>
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <div className="glow-input__field">
        <div className="glow-input__shell">
          <input
            id={id}
            className="glow-input__box"
            type="text"
            autoComplete="off"
            enterKeyHint="send"
            maxLength={MAX_QUESTION_CHARS}
            placeholder={suggestion ?? label}
            value={value}
            disabled={disabled}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={onKeyDown}
          />
          {suggestion && value === "" ? (
            <kbd className="glow-input__key" title="Press Tab to use the suggestion">
              Tab
            </kbd>
          ) : null}
          <button
            className="glow-input__send"
            type="submit"
            disabled={disabled || value.trim() === ""}
          >
            <span className="sr-only">Send</span>
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
              <path
                d="M10 15.5V4.5M5 9.5l5-5 5 5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
      <p className="glow-input__helper">Sideline uses AI and can make mistakes.</p>
    </form>
  );
}
