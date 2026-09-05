import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth-form";
import styles from "@/components/shell-experience.module.css";
import { getServerRuntime } from "@/bootstrap/server";

export const dynamic = "force-dynamic";

type AuthPageProps = Readonly<{
  searchParams: Promise<{
    mode?: string;
    next?: string;
    verified?: string;
  }>;
}>;

function safeNextPath(value: string | undefined): string {
  if (value && value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }
  return "/";
}

export default async function AuthPage({ searchParams }: AuthPageProps) {
  const { identity, registrationEnabled } = getServerRuntime();
  const current = await identity.resolve(new Headers(await headers()));
  if (current) {
    redirect("/");
  }

  const query = await searchParams;
  const nextPath = safeNextPath(query.next);
  const initialMode =
    registrationEnabled && query.mode === "sign-up" ? "sign-up" : "sign-in";

  return (
    <main
      className={styles.authPage}
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
        minHeight: "100vh",
        alignItems: "center",
        maxWidth: 1100,
        margin: "0 auto",
        padding: "60px 28px",
        gap: 64,
      }}
    >
      {/* 左侧：Shittim 诗笺风引言，无卡片，纯净纸墨留白 */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 28,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: "var(--primary)",
              boxShadow: "0 0 12px rgba(138, 68, 35, 0.4)",
            }}
          />
          <span
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: "1.85rem",
              fontWeight: 600,
              letterSpacing: "0.08em",
              color: "var(--primary)",
            }}
          >
            Shittim
          </span>
        </div>

        <h1
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "clamp(2.4rem, 4vw, 3.4rem)",
            fontWeight: 400,
            lineHeight: 1.3,
            color: "var(--ink)",
            margin: 0,
            letterSpacing: "0.04em",
          }}
        >
          继续你的学习路径
        </h1>

        <p
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "1.1rem",
            color: "var(--ink-soft)",
            lineHeight: 1.8,
            margin: 0,
            maxWidth: 420,
          }}
        >
          从真实经验与多元观点出发，
          <br />
          在可验证的地图上留下属于你的探索进度。
        </p>
      </div>

      {/* 右侧：无卡片极简登录表单 */}
      <div>
        <AuthForm
          registrationEnabled={registrationEnabled}
          initialMode={initialMode}
          verified={query.verified === "1"}
          nextPath={nextPath}
        />
      </div>
    </main>
  );
}
