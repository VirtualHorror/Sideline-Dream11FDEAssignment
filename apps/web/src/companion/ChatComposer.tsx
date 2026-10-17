/**
 * The fan's own line in the watch-along chat (Task 9): "Post" puts it in the chat on their TV's clock;
 * "Post and check it" also asks Sideline to stat-back the take against what their TV has shown (a take
 * card arrives in the feed). Fan text: the server escapes it into prompts as data.
 *
 * Caller: pages/MatchRoom.tsx, under the chat.
 */
import { useId, useState } from "react";

export function ChatComposer({
  disabled,
  pending,
  error,
  onPost,
}: {
  disabled: boolean;
  pending: boolean;
  error: string | null;
  onPost(text: string, statBack: boolean): void;
}) {
  const inputId = useId();
  const [text, setText] = useState("");
  const post = (statBack: boolean) => {
    const line = text.trim();
    if (!line || disabled || pending) return;
    onPost(line, statBack);
    setText("");
  };
  const off = disabled || pending || text.trim() === "";
  return (
    <form
      className="chat__compose"
      onSubmit={(event) => {
        event.preventDefault();
        post(false);
      }}
    >
      <label htmlFor={inputId} className="chat__compose-label">
        Say something in the chat
      </label>
      <input
        id={inputId}
        className="chat__compose-input"
        value={text}
        maxLength={280}
        placeholder="Your take on what your TV just showed"
        disabled={disabled}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="chat__compose-actions">
        <button type="submit" className="button" disabled={off}>
          Post
        </button>
        <button type="button" className="button" disabled={off} onClick={() => post(true)}>
          {pending ? "Checking…" : "Post and check it"}
        </button>
      </div>
      <p className="card__note">
        Checking looks your take up in the deliveries your TV has shown, never the ones still to
        come.
      </p>
      {error ? (
        <p className="card__note" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
