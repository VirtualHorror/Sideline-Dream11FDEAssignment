/**
 * Theme preference logic (pure, no React).
 *
 * The fan chooses Auto (follow the device), Light or Dark. The choice persists in
 * localStorage, which can throw or be empty in private windows or with blocked site
 * data, so every read and write is guarded and the app still renders without it.
 *
 * Keep THEME_STORAGE_KEY and the resolution rule in sync with public/theme-init.js,
 * the tiny pre-paint script that applies the theme before React loads (no flash).
 */
export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "sideline.theme";
export const DARK_QUERY = "(prefers-color-scheme: dark)";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type MatchMediaLike = (query: string) => { matches: boolean };

const PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark"];

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  if (preference === "system") return systemDark ? "dark" : "light";
  return preference;
}

export function readStoredPreference(storage: StorageLike | null): ThemePreference {
  try {
    const value = storage?.getItem(THEME_STORAGE_KEY);
    return PREFERENCES.find((p) => p === value) ?? "system";
  } catch {
    return "system";
  }
}

export function writeStoredPreference(
  storage: StorageLike | null,
  preference: ThemePreference,
): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage unavailable: the choice lasts for this page view only. That is acceptable.
  }
}

export function systemPrefersDark(matchMedia: MatchMediaLike | undefined): boolean {
  return typeof matchMedia === "function" ? matchMedia(DARK_QUERY).matches : false;
}

/** window.localStorage itself can throw on access; this never does. */
export function safeLocalStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}
