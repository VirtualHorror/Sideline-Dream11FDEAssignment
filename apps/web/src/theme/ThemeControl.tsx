/**
 * Auto / Light / Dark segmented control.
 *
 * Applies the resolved theme to <html data-theme>, which every token in
 * styles/tokens.css keys off. In Auto it also follows live OS changes (e.g. a phone
 * switching to dark at sunset) via a matchMedia listener.
 */
import { useEffect, useId, useState } from "react";
import {
  DARK_QUERY,
  readStoredPreference,
  resolveTheme,
  safeLocalStorage,
  systemPrefersDark,
  type ThemePreference,
  writeStoredPreference,
} from "./theme.ts";

const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const getMatchMedia = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia.bind(window)
    : undefined;

function applyTheme(preference: ThemePreference): void {
  const resolved = resolveTheme(preference, systemPrefersDark(getMatchMedia()));
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePref = preference;
}

export function ThemeControl() {
  const name = useId();
  const [preference, setPreference] = useState<ThemePreference>(() =>
    readStoredPreference(safeLocalStorage()),
  );

  useEffect(() => {
    applyTheme(preference);
    if (preference !== "system") return;
    const media = getMatchMedia()?.(DARK_QUERY);
    if (!media || typeof media.addEventListener !== "function") return;
    const onChange = () => applyTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [preference]);

  const choose = (value: ThemePreference) => {
    setPreference(value);
    writeStoredPreference(safeLocalStorage(), value);
  };

  return (
    <fieldset className="theme-control">
      <legend className="sr-only">Colour theme</legend>
      {OPTIONS.map((option) => (
        <label key={option.value} className="theme-control__option">
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={preference === option.value}
            onChange={() => choose(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
