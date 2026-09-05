"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Alert, Button } from "antd";

import styles from "./shell-experience.module.css";
import { apiRequest } from "@/shared/ui/api-client";

const APP_NAV_ITEMS = [
  { href: "/", label: "探索" },
  { href: "/featured", label: "精选航标" },
  { href: "/learning", label: "我的学径" },
] as const;

function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/learning") {
    return pathname === "/learning" || pathname.startsWith("/learn/");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

type AppHeaderProps = Readonly<{
  email: string;
  eyebrow?: string;
}>;

export function AppHeader({ email }: AppHeaderProps) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isHeaderHidden, setIsHeaderHidden] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isPortalReady, setIsPortalReady] = useState(false);

  useEffect(() => {
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (y < 96 || y < lastY - 4) {
        setIsHeaderHidden(false);
      } else if (y > lastY + 4) {
        setIsHeaderHidden(true);
      }
      lastY = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setIsPortalReady(true);
  }, []);

  useEffect(() => {
    document.body.classList.toggle("drawer-scroll-lock", isDrawerOpen);
    return () => document.body.classList.remove("drawer-scroll-lock");
  }, [isDrawerOpen]);

  useEffect(() => {
    setIsDrawerOpen(false);
  }, [pathname]);

  async function signOut() {
    setError(null);
    setIsSigningOut(true);
    try {
      await apiRequest<unknown>("/api/auth/sign-out", {
        method: "POST",
        body: JSON.stringify({}),
      });
      router.replace("/auth");
      router.refresh();
    } catch {
      setError("暂时无法退出，请稍候重试。");
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <header
      className={`${styles.appHeader} app-header${
        isHeaderHidden ? "app-header-hidden" : ""
      }`}
      style={{
        borderBottom: "1px dashed var(--line)",
        background: "rgba(251, 246, 236, 0.88)",
        backdropFilter: "blur(12px)",
      }}
    >
      <div className={styles.appHeaderInner}>
        <Link
          className={styles.brandMark}
          href="/"
          aria-label="返回 Shittim 首页"
          style={{ textDecoration: "none" }}
        >
          <span
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: "1.45rem",
              fontWeight: 600,
              letterSpacing: "0.06em",
              color: "var(--primary)",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "var(--primary)",
                display: "inline-block",
                boxShadow: "0 0 10px rgba(138, 68, 35, 0.45)",
              }}
            />
            Shittim
          </span>
        </Link>

        <nav className={styles.appNav} aria-label="主要导航">
          {APP_NAV_ITEMS.map((item) => {
            const isActive = isNavItemActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                className={`${styles.appNavLink} ${
                  isActive ? styles.appNavLinkActive : ""
                }`}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                style={{
                  fontFamily: "var(--font-serif)",
                  fontSize: "0.95rem",
                  letterSpacing: "0.04em",
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className={styles.accountArea}>
          <span
            className={styles.accountEmail}
            title={email}
            style={{
              color: "var(--ink-muted)",
              fontSize: "0.85rem",
              fontFamily: "var(--font-body)",
            }}
          >
            {email}
          </span>
          <Button
            type="text"
            size="small"
            className={styles.signOutButton}
            onClick={() => void signOut()}
            loading={isSigningOut}
            style={{
              color: "var(--ink-soft)",
              fontFamily: "var(--font-body)",
            }}
          >
            退出登录
          </Button>
          <button
            type="button"
            className="app-menu-toggle"
            aria-label={isDrawerOpen ? "关闭菜单" : "打开菜单"}
            aria-expanded={isDrawerOpen}
            onClick={() => setIsDrawerOpen((open) => !open)}
          >
            <span aria-hidden="true" />
            <span aria-hidden="true" />
            <span aria-hidden="true" />
          </button>
        </div>
      </div>

      {error ? (
        <Alert
          className={styles.headerMessage}
          type="error"
          showIcon
          message={error}
        />
      ) : null}

      {isPortalReady
        ? createPortal(
            <>
              <div
                className={`app-drawer-backdrop${isDrawerOpen ? "is-open" : ""}`}
                onClick={() => setIsDrawerOpen(false)}
                aria-hidden="true"
              />
              <nav
                className={`app-drawer${isDrawerOpen ? "is-open" : ""}`}
                aria-label="移动端菜单"
                aria-hidden={!isDrawerOpen}
              >
                <div className="app-drawer-nav">
                  {APP_NAV_ITEMS.map((item) => {
                    const isActive = isNavItemActive(pathname, item.href);
                    return (
                      <Link
                        key={item.href}
                        className={`app-drawer-link${isActive ? "is-active" : ""}`}
                        href={item.href}
                        aria-current={isActive ? "page" : undefined}
                        onClick={() => setIsDrawerOpen(false)}
                        style={{ fontFamily: "var(--font-serif)" }}
                      >
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
                <div className="app-drawer-footer">
                  <span className="app-drawer-email" title={email}>
                    {email}
                  </span>
                  <Button
                    size="small"
                    onClick={() => void signOut()}
                    loading={isSigningOut}
                  >
                    退出登录
                  </Button>
                </div>
              </nav>
            </>,
            document.body,
          )
        : null}
    </header>
  );
}
