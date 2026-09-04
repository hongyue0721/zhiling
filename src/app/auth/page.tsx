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
    <main className={styles.authPage}>
      <div className={styles.authAside}>
        <div className={styles.authAsideGrid} aria-hidden="true" />
        <div className={styles.authAsideContent}>
          <span className={styles.authBrand} aria-hidden="true">
            <span className={styles.authBrandGlyph}>
              <svg
                className={styles.authBrandRoute}
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
            <span className={styles.authBrandName}>知径</span>
          </span>
          <div className={styles.authAsideSignal} aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <p className={styles.authAsideQuote}>
            把零散讨论，走成一条学会的路。
          </p>
          <div className={styles.authAsidePoints}>
            <span>真实来源</span>
            <span>多视角观点</span>
            <span>服务端验证</span>
          </div>
        </div>
      </div>
      <AuthForm
        registrationEnabled={registrationEnabled}
        initialMode={initialMode}
        verified={query.verified === "1"}
        nextPath={nextPath}
      />
    </main>
  );
}
