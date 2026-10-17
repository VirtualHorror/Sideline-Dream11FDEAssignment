import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DitherVeil } from "../src/effects/DitherVeil.tsx";
import { FloodlightGlow, type FloodlightHandle } from "../src/effects/FloodlightGlow.tsx";
import { GhostText } from "../src/effects/GhostText.tsx";
import { GlowInput } from "../src/effects/GlowInput.tsx";

/** jsdom has neither WebGL2 nor matchMedia: tests add exactly what each case needs. */
function withWebGL2() {
  vi.stubGlobal("WebGL2RenderingContext", class {});
}
function withReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: reduce && query === "(prefers-reduced-motion: reduce)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderEffects() {
  return render(
    <div>
      <FloodlightGlow />
      <GhostText text="Sideline" as="h1" mode="pointer" />
      <div style={{ position: "relative" }}>
        <DitherVeil intensity={1} />
      </div>
    </div>,
  );
}

describe("effects fall back to CSS (PLAN 6.3, Review focus 4)", () => {
  it("draws no canvas and keeps the text readable when WebGL2 is missing", () => {
    const { container } = renderEffects();
    expect(container.querySelector("canvas")).toBeNull();
    expect(screen.getByRole("heading", { name: "Sideline" })).toBeTruthy();
    expect(container.querySelector('[data-effect="ghost"]')?.getAttribute("data-render")).toBe(
      "css",
    );
    expect(container.querySelector('[data-effect="veil"]')?.getAttribute("data-render")).toBe(
      "css",
    );
    expect(container.querySelector('[data-effect="floodlight"]')?.getAttribute("data-motion")).toBe(
      "ambient",
    );
  });

  it("goes static under prefers-reduced-motion: reduce, even with WebGL2", () => {
    withWebGL2();
    withReducedMotion(true);
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext");
    const { container } = renderEffects();
    expect(container.querySelector("canvas")).toBeNull();
    expect(getContext).not.toHaveBeenCalled();
    expect(container.querySelector('[data-effect="ghost"]')?.getAttribute("data-render")).toBe(
      "css",
    );
    const veil = container.querySelector('[data-effect="veil"]');
    expect(veil?.getAttribute("data-render")).toBe("css");
    expect(veil?.getAttribute("data-motion")).toBe("reduced");
    expect(container.querySelector('[data-effect="floodlight"]')?.getAttribute("data-motion")).toBe(
      "static",
    );
  });

  it("falls back when the browser refuses a WebGL2 context", () => {
    withWebGL2();
    withReducedMotion(false);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const { container } = renderEffects();
    expect(container.querySelector('[data-effect="ghost"]')?.getAttribute("data-render")).toBe(
      "css",
    );
    expect(container.querySelector('[data-effect="veil"]')?.getAttribute("data-render")).toBe(
      "css",
    );
    expect(container.querySelector("canvas")).toBeNull();
  });
});

describe("DitherVeil", () => {
  it("states the intensity it veils at", () => {
    const { container, rerender } = render(<DitherVeil intensity={1} />);
    const veil = container.querySelector('[data-effect="veil"]');
    expect(veil?.getAttribute("data-intensity")).toBe("1");
    rerender(<DitherVeil intensity={0} />);
    expect(veil?.getAttribute("data-intensity")).toBe("0");
  });
});

describe("FloodlightGlow", () => {
  it("exposes an outburst that records its colour", () => {
    const handle = createRef<FloodlightHandle>();
    const { container } = render(<FloodlightGlow burstRef={handle} />);
    act(() => handle.current?.burst("#ffc94a", 1.4));
    const glow = container.querySelector('[data-effect="floodlight"]');
    expect(glow?.getAttribute("data-burst")).toBe("#ffc94a");
  });
});

describe("GlowInput (PLAN 6.3)", () => {
  it("exposes its state via data-state", () => {
    const { container, rerender } = render(
      <GlowInput state="idle" label="Ask Sideline" onSubmit={() => {}} />,
    );
    const root = container.querySelector('[data-effect="glow-input"]');
    expect(root?.getAttribute("data-state")).toBe("idle");
    rerender(<GlowInput state="thinking" label="Ask Sideline" onSubmit={() => {}} />);
    expect(root?.getAttribute("data-state")).toBe("thinking");
  });

  it("takes the suggestion with Tab when empty, and submits trimmed text", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <GlowInput
        state="idle"
        label="Ask Sideline"
        suggestion="What is a free hit?"
        onSubmit={onSubmit}
      />,
    );
    const input = screen.getByRole("textbox", { name: "Ask Sideline" });
    expect(screen.getByText("Tab")).toBeTruthy();
    await user.click(input);
    await user.keyboard("{Tab}");
    expect((input as HTMLInputElement).value).toBe("What is a free hit?");
    await user.clear(input);
    await user.type(input, "   why that bowler?  ");
    await user.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("why that bowler?");
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("leaves typed text alone on Tab and lets focus move on", async () => {
    const user = userEvent.setup();
    render(
      <GlowInput
        state="idle"
        label="Ask Sideline"
        suggestion="What is a free hit?"
        onSubmit={() => {}}
      />,
    );
    const input = screen.getByRole("textbox", { name: "Ask Sideline" }) as HTMLInputElement;
    await user.click(input);
    await user.type(input, "why");
    await user.keyboard("{Tab}");
    expect(input.value).toBe("why");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Send" }));
  });

  it("does not submit blank text or questions over 280 characters", () => {
    const onSubmit = vi.fn();
    render(<GlowInput state="idle" label="Ask Sideline" onSubmit={onSubmit} />);
    const input = screen.getByRole("textbox", { name: "Ask Sideline" }) as HTMLInputElement;
    expect(input.maxLength).toBe(280);
    fireEvent.change(input, { target: { value: "    " } });
    fireEvent.submit(input);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("says that it uses AI", () => {
    render(<GlowInput state="idle" label="Ask Sideline" onSubmit={() => {}} />);
    expect(screen.getByText("Sideline uses AI and can make mistakes.")).toBeTruthy();
  });
});
