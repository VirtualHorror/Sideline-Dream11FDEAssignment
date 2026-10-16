import { describe, expect, it } from "vitest";
import {
  readStoredPreference,
  resolveTheme,
  systemPrefersDark,
  THEME_STORAGE_KEY,
  writeStoredPreference,
} from "../src/theme/theme.ts";

const memoryStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  };
};
const throwingStorage = {
  getItem: () => {
    throw new Error("SecurityError: storage disabled");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

describe("resolveTheme", () => {
  it("follows the device when the preference is 'system'", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("lets an explicit choice override the device", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("stored preference", () => {
  it("round-trips a choice through storage", () => {
    const storage = memoryStorage();
    writeStoredPreference(storage, "dark");
    expect(storage.data.get(THEME_STORAGE_KEY)).toBe("dark");
    expect(readStoredPreference(storage)).toBe("dark");
  });

  it("falls back to 'system' for missing or tampered values", () => {
    expect(readStoredPreference(memoryStorage())).toBe("system");
    expect(readStoredPreference(memoryStorage({ [THEME_STORAGE_KEY]: "neon" }))).toBe("system");
  });

  it("survives storage that throws (private mode, blocked site data)", () => {
    expect(readStoredPreference(throwingStorage)).toBe("system");
    expect(() => writeStoredPreference(throwingStorage, "light")).not.toThrow();
  });
});

describe("systemPrefersDark", () => {
  it("is false when matchMedia is unavailable instead of crashing", () => {
    expect(systemPrefersDark(undefined)).toBe(false);
  });

  it("reads the prefers-color-scheme media query", () => {
    const fakeMatchMedia = (q: string) => ({ matches: q === "(prefers-color-scheme: dark)" });
    expect(systemPrefersDark(fakeMatchMedia)).toBe(true);
  });
});
