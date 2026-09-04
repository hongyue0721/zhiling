import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth-form";
import { emailVerificationEnabled, identity } from "@/bootstrap/server";

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
  const current = await identity.resolve(new Headers(await headers()));
  if (current) {
    redirect("/");
  }

  const query = await searchParams;
  const nextPath = safeNextPath(query.next);
  const initialMode = query.mode === "sign-up" ? "sign-up" : "sign-in";
  return (
    <main className="auth-page">
      <div className="auth-page-aside">
        <span className="brand-lockup" aria-hidden="true">
          <span className="brand-mark-symbol">Z</span>
          <span className="brand-mark-name">知径</span>
        </span>
        <p className="auth-aside-quote">把零散讨论，走成一条学会的路。</p>
        <div className="auth-aside-points">
          <span>真实来源</span>
          <span>多视角观点</span>
          <span>服务端验证</span>
        </div>
      </div>
      <AuthForm
        emailVerificationEnabled={emailVerificationEnabled}
        initialMode={initialMode}
        verified={emailVerificationEnabled && query.verified === "1"}
        nextPath={nextPath}
      />
    </main>
  );
}
