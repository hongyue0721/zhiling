"use client";
import "./bookish-fonts";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  currentBookTheme,
  toggleBookTheme,
  applyBookTheme,
  THEME_STORAGE_KEY,
  normalizedTheme,
} from "./bookish-theme";
import s from "./scenes.module.css";

/** Keep the handwritten word intact so cursive connections are not broken. */
export function Signature({
  word = "Shittim",
  large = false,
}: {
  word?: string;
  large?: boolean;
}) {
  if (large) return <span className={s.largeSignature}>{word}</span>;
  return (
    <span className={s.signature} aria-label={word}>
      <span aria-hidden="true">
        {Array.from(word).map((letter, index) => (
          <span
            key={`${letter}-${index}`}
            style={{ "--letter": index } as CSSProperties}
          >
            {letter === " " ? "\u00a0" : letter}
          </span>
        ))}
      </span>
    </span>
  );
}
export function BookThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const update = () => setDark(currentBookTheme() === "dark");
    const storage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY)
        applyBookTheme(normalizedTheme(event.newValue));
    };
    if (!document.documentElement.dataset.shittimTone) {
      try {
        applyBookTheme(
          normalizedTheme(localStorage.getItem(THEME_STORAGE_KEY)),
        );
      } catch {
        applyBookTheme("light");
      }
    }
    update();
    window.addEventListener("shittim:theme", update);
    window.addEventListener("storage", storage);
    return () => {
      window.removeEventListener("shittim:theme", update);
      window.removeEventListener("storage", storage);
    };
  }, []);
  return (
    <button
      type="button"
      className={s.themeButton}
      role="switch"
      aria-checked={dark}
      aria-label={dark ? "切换至米纸日间" : "切换至暖灯夜读"}
      title={dark ? "米纸日间" : "暖灯夜读"}
      onClick={() => void toggleBookTheme()}
    >
      <svg
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        aria-hidden="true"
      >
        {dark ? (
          <path d="M20.5 13A8.5 8.5 0 0 1 11 3.5 8.5 8.5 0 1 0 20.5 13Z" />
        ) : (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M20 4l-2 2M6 18l-2 2" />
          </>
        )}
      </svg>
    </button>
  );
}
/** Optional fan-art bookmark. Uses the user-supplied illustration locally; no external image request. */
export function AnonBookmark() {
  const [open, setOpen] = useState(false),
    [image, setImage] = useState<"local" | "missing">("local");
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open]);
  return (
    <div className={s.bookmark}>
      <button
        type="button"
        ref={button}
        className={s.bookmarkTab}
        aria-label="打开爱音书签彩蛋"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">♪</span>
      </button>
      {open && (
        <aside className={s.anonNote} aria-label="爱音书签">
          <button
            type="button"
            className={s.anonClose}
            aria-label="收起书签"
            onClick={() => {
              setOpen(false);
              button.current?.focus();
            }}
          >
            ×
          </button>
          <span className={s.anonSignature} aria-hidden="true">
            a little encore
          </span>
          {image !==
          "missing" /* eslint-disable-next-line @next/next/no-img-element */ ? (
            <img
              className={s.anonImage}
              width="240"
              height="240"
              alt="千早爱音的 Q 版彩蛋"
              src="/shittim/anon-easter.webp"
              onError={() => setImage("missing")}
            />
          ) : (
            <span className={s.anonFallback}>
              Anon<span>♪</span>
            </span>
          )}
          <p>这一页，也一起读完吧。</p>
        </aside>
      )}
    </div>
  );
}
