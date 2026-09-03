"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { apiRequest } from "@/shared/ui/api-client";

type AppHeaderProps = Readonly<{
  email: string;
  eyebrow?: string;
}>;

export function AppHeader({ email, eyebrow = "知径" }: AppHeaderProps) {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    setError(null);
    setIsSigningOut(true);
    try {
      await apiRequest<unknown>("/api/auth/sign-out", { method: "POST" });
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
          <Link href="/">我的学习</Link>
          <Link href="/generate">现场生成</Link>
        </nav>
        <div className="account-area">
          <span className="account-email" title={email}>
            {email}
          </span>
          <button
            type="button"
            className="button button-quiet button-small"
            onClick={signOut}
            disabled={isSigningOut}
          >
            {isSigningOut ? "退出中…" : "退出登录"}
          </button>
        </div>
      </div>
      {error ? (
        <div className="app-header-message" role="status">
          {error}
        </div>
      ) : null}
    </header>
  );
}
