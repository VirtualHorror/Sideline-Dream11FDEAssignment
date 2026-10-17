/**
 * Whether a media query matches, following live changes (the match room swaps its desktop grid for
 * the phone's tabs at the breakpoint). Without matchMedia (jsdom) it answers false: desktop.
 */
import { useEffect, useState } from "react";

const matches = (query: string) =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(query).matches
    : false;

export function useMediaQuery(query: string): boolean {
  const [value, setValue] = useState(() => matches(query));
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(query);
    const onChange = () => setValue(media.matches);
    onChange();
    media.addEventListener?.("change", onChange);
    return () => media.removeEventListener?.("change", onChange);
  }, [query]);
  return value;
}
