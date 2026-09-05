"use client";
import { usePathname } from "next/navigation";
import { Scene } from "./scene";

/**
 * Full-screen dedicated pages own their own Scene (home/generate/learn).
 * The auth page paints an opaque coffee panel, so it also renders no scene.
 * Remaining secondary pages (e.g. report) get a shared ambient paper backdrop
 * so the warm bookish canvas never double-renders behind a full-screen view.
 */
export function RouteBackground() {
  const pathname = usePathname() ?? "";
  const dedicated =
    pathname === "/" ||
    /^\/generate\/?$/.test(pathname) ||
    /^\/learn\/[^/]+\/?$/.test(pathname) ||
    /^\/auth\/?$/.test(pathname);
  if (dedicated) {
    return null;
  }
  return <Scene mode="ambient" />;
}
