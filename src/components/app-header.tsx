"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button } from "antd";

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
    <header className="app-header">
      <div className="app-header-inner">
        <Link className="brand-mark" href="/" aria-label="返回知径首页">
          <span className="brand-mark-symbol" aria-hidden="true">
            Z
          </span>
          <span>
            <span className="brand-mark-name">知径</span>
            <span className="brand-mark-eyebrow">{eyebrow}</span>
          </span>
        </Link>
        <nav className="app-nav" aria-label="主要导航">
          {APP_NAV_ITEMS.map((item) => {
            const isActive = isNavItemActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                className={isActive ? "is-active" : undefined}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="account-area">
          <span className="account-email" title={email}>
            {email}
          </span>
          <Button
            type="text"
            size="small"
            className="button button-quiet button-small"
            onClick={() => void signOut()}
            loading={isSigningOut}
          >
            退出登录
          </Button>
        </div>
      </div>
      {error ? (
        <Alert
          className="app-header-message"
          type="error"
          showIcon
          message={error}
        />
      ) : null}
    </header>
  );
}
