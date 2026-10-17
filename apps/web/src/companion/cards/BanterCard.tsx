/**
 * The friend-league cope card (phase 2): the comeback quest's banter, shareable as an image. "Share
 * card" uses the Web Share API when the browser has it (with the PNG when it can share files, else the
 * text); otherwise "Download card" saves the PNG (share/cardImage.ts).
 *
 * Caller: companion/cards/BailoutQuestCard.tsx. `share` and `draw` default to the browser's and are
 * passed in by tests.
 */
import type { BailoutPayload } from "@sideline/engine";
import { useState } from "react";
import { renderCardPng, TONE_LABELS } from "../../share/cardImage.ts";

type Banter = BailoutPayload["banter"];

export interface ShareTarget {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
}

const browserShare = (): ShareTarget =>
  typeof navigator !== "undefined" && typeof navigator.share === "function"
    ? {
        share: (data) => navigator.share(data),
        canShare: (data) => navigator.canShare?.(data) ?? false,
      }
    : {};

function download(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "sideline-card.png";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

type Status = "idle" | "working" | "shared" | "saved" | "failed";

export function BanterCard({
  banter,
  share = browserShare(),
  draw = renderCardPng,
}: {
  banter: Banter;
  share?: ShareTarget;
  draw?: (banter: Banter) => Promise<Blob | null>;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const canShare = typeof share.share === "function";

  async function onShare() {
    setStatus("working");
    try {
      const blob = await draw(banter);
      if (blob && canShare) {
        const file = new File([blob], "sideline-card.png", { type: "image/png" });
        if (share.canShare?.({ files: [file] })) {
          await share.share?.({ files: [file], text: banter.shareText });
          setStatus("shared");
          return;
        }
      }
      if (canShare) {
        await share.share?.({ text: banter.shareText });
        setStatus("shared");
        return;
      }
      if (blob) {
        download(blob);
        setStatus("saved");
        return;
      }
      setStatus("failed");
    } catch {
      // A share sheet the fan closed is not an error worth a message.
      setStatus("idle");
    }
  }

  return (
    <section className="banter" data-tone={banter.tone} aria-label="Banter card">
      <p className="banter__tone">{TONE_LABELS[banter.tone]}</p>
      <p className="banter__headline">{banter.headline}</p>
      <p className="banter__body">{banter.body}</p>
      <div className="banter__actions">
        <button
          type="button"
          className="button"
          disabled={status === "working"}
          onClick={() => void onShare()}
        >
          {canShare ? "Share card" : "Download card"}
        </button>
        <span className="card__note" aria-live="polite">
          {status === "shared"
            ? "Shared."
            : status === "saved"
              ? "Saved as sideline-card.png."
              : status === "failed"
                ? "This browser cannot draw the card: copy the text instead."
                : ""}
        </span>
      </div>
    </section>
  );
}
