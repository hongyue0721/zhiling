"use client";
import Link from "next/link";
import { useState } from "react";
import { LibraryDrawer } from "./library-drawer";
import { Signature, BookThemeToggle } from "./bookish-chrome";
import s from "./scenes.module.css";
export type FlowStep = "home" | "generation" | "map" | "reading";
export function FlowHeader({
  active,
  paused,
  onPause,
  onHome,
  onGeneration,
  onMap,
  onRead,
  email,
}: {
  active: FlowStep;
  paused: boolean;
  onPause: () => void;
  onHome?: () => void;
  onGeneration?: () => void;
  onMap?: () => void;
  onRead?: () => void;
  email?: string;
}) {
  const [library, setLibrary] = useState(false);
  const steps = [
    {
      id: "home",
      label: "起笔",
      action: onHome,
      href: onHome ? undefined : "/",
    },
    { id: "generation", label: "成卷", action: onGeneration },
    { id: "map", label: "图谱", action: onMap },
    { id: "reading", label: "研读", action: onRead },
  ];
  return (
    <>
      <header className={s.topbar}>
        <Link href="/" className={s.brand} aria-label="Shittim 起笔">
          <span className={s.brandMark} aria-hidden="true">
            什
          </span>
          <Signature />
        </Link>
        <nav className={s.flowNav} aria-label="探索流程">
          {steps.map((step, index) => (
            <span className={s.flowItem} key={step.id}>
              {index > 0 && <i aria-hidden="true" />}
              {step.href ? (
                <Link
                  href={step.href}
                  aria-current={active === step.id ? "step" : undefined}
                >
                  {step.label}
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={step.action}
                  disabled={!step.action && active !== step.id}
                  aria-current={active === step.id ? "step" : undefined}
                >
                  {step.label}
                </button>
              )}
            </span>
          ))}
        </nav>
        <div className={s.topActions}>
          <BookThemeToggle />
          <button
            type="button"
            className={s.tool}
            aria-label={paused ? "播放动效" : "暂停动效"}
            aria-pressed={paused}
            onClick={onPause}
          >
            {paused ? "▷" : "Ⅱ"}
          </button>
          <button
            type="button"
            className={s.libraryLink}
            onClick={() => setLibrary(true)}
            aria-expanded={library}
            title={email}
          >
            藏书
          </button>
        </div>
      </header>
      <LibraryDrawer open={library} onClose={() => setLibrary(false)} />
    </>
  );
}
