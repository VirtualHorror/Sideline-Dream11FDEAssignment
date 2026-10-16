// Pre-paint theme bootstrap. Runs synchronously in <head> before the app bundle, so the
// page never flashes the wrong theme. Mirrors src/theme/theme.ts: keep the storage key
// ("sideline.theme") and the resolution rule identical in both files.
(() => {
  let preference = "system";
  try {
    const stored = window.localStorage.getItem("sideline.theme");
    if (stored === "light" || stored === "dark" || stored === "system") preference = stored;
  } catch (_) {
    // Storage blocked (private mode, disabled site data): fall back to the OS setting.
  }
  const systemDark =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = preference === "dark" || (preference === "system" && systemDark);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.dataset.themePref = preference;
})();
