import { describe, expect, it } from "vitest";
import { momentVisibility, releaseDue } from "../src/index.ts";

describe("releaseDue (the per-fan delay buffer)", () => {
  const items = [
    { id: "a", t: 1_000 },
    { id: "b", t: 5_000 },
    { id: "c", t: 5_001 },
    { id: "d", t: 9_000 },
  ];

  it("releases everything the fan's TV has reached and holds the rest, in order", () => {
    expect(releaseDue(items, 5_000)).toEqual({
      released: [items[0], items[1]],
      held: [items[2], items[3]],
    });
  });

  it("holds everything before the first item and releases everything after the last", () => {
    expect(releaseDue(items, 999)).toEqual({ released: [], held: items });
    expect(releaseDue(items, 9_000)).toEqual({ released: items, held: [] });
  });

  it("keeps the input order even when stamps arrive out of order", () => {
    const shuffled = [items[3], items[0], items[2], items[1]].filter((item) => item !== undefined);
    expect(releaseDue(shuffled, 5_000)).toEqual({
      released: [items[0], items[1]],
      held: [items[3], items[2]],
    });
  });
});

describe("momentVisibility (spoiler-safe card states on the TV clock)", () => {
  const card = { nudgeAt: 40_000, revealAt: 46_000 };

  it.each([
    [39_999, "hidden"],
    [40_000, "teaser"],
    [45_999, "teaser"],
    [46_000, "revealed"],
    [90_000, "revealed"],
  ] as const)("at TV time %i the card is %s", (tvT, visibility) => {
    expect(momentVisibility(card, tvT)).toBe(visibility);
  });

  it("goes straight from hidden to revealed when there is no teaser", () => {
    expect(momentVisibility({ nudgeAt: null, revealAt: 46_000 }, 45_999)).toBe("hidden");
    expect(momentVisibility({ nudgeAt: null, revealAt: 46_000 }, 46_000)).toBe("revealed");
  });

  it("shows a card with no reveal time at once (MomentSchema: null revealAt = show immediately)", () => {
    expect(momentVisibility({ nudgeAt: null, revealAt: null }, 0)).toBe("revealed");
  });
});
