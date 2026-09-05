"use client";
import { usePathname } from "next/navigation";
import { Scene } from "./scene";

/**
 * Full-screen dedicated pages own their own Scene (home/generate/learn).
 * Only secondary pages (auth/report) get a shared ambient paper backdrop so
 * the warm bookish canvas never double-renders behind a full-screen renderer.
 */
export function RouteBackground() {
  const pathname = usePathname() ?? "";
  const dedicated =
    pathname === "/" ||
    /^\/generate\/?$/.test(pathname) ||
    /^\/learn\/[^/]+\/?$/.test(pathname);
  if (dedicated) {
    return null;
  }
  return <Scene mode="ambient" />;
}
