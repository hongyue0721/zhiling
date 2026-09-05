"use client";
import { useEffect, useRef, type ReactNode } from "react";
import s from "./scenes.module.css";
/** Native modal supplies focus containment and makes the canvas inert while open. */
export function Overlay({
  open,
  onClose,
  title,
  drawer = false,
  busy = false,
  keepMounted = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  drawer?: boolean;
  busy?: boolean;
  keepMounted?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    previousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      previousFocus.current = document.activeElement as HTMLElement;
      dialog.showModal();
    }
    if (!open && dialog.open) {
      dialog.close();
      previousFocus.current?.focus({ preventScroll: true });
    }
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={drawer ? s.drawer : s.dialog}
      aria-label={title}
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) {
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            onClose();
        }
      }}
    >
      <button
        type="button"
        className={s.close}
        aria-label="关闭"
        title="关闭（Esc）"
        onClick={onClose}
        disabled={busy}
      >
        ×
      </button>
      {open || keepMounted ? children : null}
    </dialog>
  );
}
