import type { PaperTheme } from "./paper-model";
export const THEME_STORAGE_KEY = "shittim-paper-theme";
export function normalizedTheme(value: unknown): PaperTheme {
  return value === "dark" ? "dark" : "light";
}
export function currentBookTheme(): PaperTheme {
  return typeof document === "undefined"
    ? "light"
    : normalizedTheme(document.documentElement.dataset.shittimTone);
}
export function applyBookTheme(theme: PaperTheme): void {
  document.documentElement.dataset.shittimTone = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* Optional persistence. */
  }
  window.dispatchEvent(new Event("shittim:theme"));
}
let switching = false;
export async function toggleBookTheme(): Promise<void> {
  if (switching) return;
  const next = currentBookTheme() === "dark" ? "light" : "dark";
  const root = document.documentElement;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || typeof document.startViewTransition !== "function") {
    applyBookTheme(next);
    return;
  }
  switching = true;
  root.style.setProperty(
    "--book-reveal-from",
    next === "dark" ? "0 0 100% 0" : "0 0 0 100%",
  );
  root.classList.add("book-theme-switching");
  try {
    await document.startViewTransition(() => applyBookTheme(next)).finished;
  } catch {
    applyBookTheme(next);
  } finally {
    switching = false;
    root.classList.remove("book-theme-switching");
    root.style.removeProperty("--book-reveal-from");
  }
}
