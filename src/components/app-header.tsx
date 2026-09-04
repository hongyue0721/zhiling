"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Alert, Button } from "antd";

import styles from "./shell-experience.module.css";

import { apiRequest } from "@/shared/ui/api-client";

const APP_NAV_ITEMS = [
  { href: "/", label: "首页" },
  { href: "/featured", label: "精选地图" },
  { href: "/learning", label: "我的学习" },
  { href: "/generate", label: "现场生成" },
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

export function AppHeader({ email, eyebrow = "知径" }: AppHeaderProps) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isHeaderHidden, setIsHeaderHidden] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  // 遮罩与抽屉经 portal 挂到 body：顶栏的 backdrop-filter/transform
  // 会把 position:fixed 后代的包含块劫持到顶栏，导致遮罩只盖住顶栏一条
  const [isPortalReady, setIsPortalReady] = useState(false);

  // 桌面端下滑隐藏顶栏、上滑恢复，长页阅读时不占视线
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

  // 抽屉打开期间锁定背景滚动
  useEffect(() => {
    document.body.classList.toggle("drawer-scroll-lock", isDrawerOpen);
    return () => document.body.classList.remove("drawer-scroll-lock");
  }, [isDrawerOpen]);

  useEffect(() => {
    setIsPortalReady(true);
  }, []);

  // 路由变化自动收起抽屉
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
      setError("暂时无法退出，请稍后再试。");
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <header
      className={`${styles.appHeader} app-header${
        isHeaderHidden ? "app-header-hidden" : ""
      }`}
    >
      <div className={styles.appHeaderInner}>
        <Link className={styles.brandMark} href="/" aria-label="返回知径首页">
          <span className={styles.brandSymbol} aria-hidden="true">
            <svg
              className={styles.brandGlyph}
              viewBox="0 0 48 48"
              role="presentation"
            >
              <path d="M8 32.5 18.5 22l8 8L40 16.5" />
              <circle cx="8" cy="32.5" r="3" />
              <circle cx="18.5" cy="22" r="3" />
              <circle cx="26.5" cy="30" r="3" />
              <circle cx="40" cy="16.5" r="3" />
            </svg>
          </span>
          <span className={styles.brandCopy}>
            <span className={styles.brandName}>知径</span>
            <span className={styles.brandEyebrow}>{eyebrow}</span>
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
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className={styles.accountArea}>
          <span className={styles.accountEmail} title={email}>
            {email}
          </span>
          <Button
            type="text"
            size="small"
            className={styles.signOutButton}
            onClick={() => void signOut()}
            loading={isSigningOut}
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
                className={`app-drawer-backdrop${isDrawerOpen ? " is-open" : ""}`}
                onClick={() => setIsDrawerOpen(false)}
                aria-hidden="true"
              />
              <nav
                className={`app-drawer${isDrawerOpen ? " is-open" : ""}`}
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
