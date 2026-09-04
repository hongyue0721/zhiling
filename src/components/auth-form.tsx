"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";

import { ApiRequestError, isApiRequestError } from "@/shared/ui/api-client";

const MIN_PASSWORD_LENGTH = 12;

type AuthMode = "sign-in" | "sign-up" | "verify";

type AuthFormProps = Readonly<{
  emailVerificationEnabled: boolean;
  initialMode?: AuthMode;
  verified?: boolean;
  nextPath?: string;
}>;

function authErrorMessage(error: unknown): string {
  if (!isApiRequestError(error)) {
    return "网络连接失败，请稍后重试。";
  }

  if (error.code === "EMAIL_NOT_VERIFIED" || error.status === 403) {
    return "邮箱尚未验证。请先检查邮箱，或使用下方按钮重新发送验证邮件。";
  }
  if (error.code === "INVALID_EMAIL_OR_PASSWORD" || error.status === 401) {
    return "邮箱或密码不正确，请检查后重试。";
  }
  if (error.code === "VERIFICATION_EMAIL_DELIVERY_FAILED") {
    return "验证邮件暂时无法发送，请稍后重试。";
  }
  if (error.status === 429) {
    return "操作过于频繁，请稍后再试。";
  }
  if (error.code === "USER_ALREADY_EXISTS") {
    return "该邮箱无法完成注册，请尝试登录或使用其他邮箱。";
  }
  if (error.status >= 500) {
    return "认证服务暂时不可用，请稍后重试。";
  }
  return "请求未完成，请检查输入后重试。";
}

function safeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function AuthForm({
  emailVerificationEnabled,
  initialMode = "sign-in",
  verified = false,
  nextPath = "/",
}: AuthFormProps) {
  const router = useRouter();
  const verificationMessageVisible = emailVerificationEnabled && verified;
  const [mode, setMode] = useState<AuthMode>(
    verificationMessageVisible ||
      (!emailVerificationEnabled && initialMode === "verify")
      ? "sign-in"
      : initialMode,
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(
    verificationMessageVisible ? "邮箱已验证，请使用密码登录。" : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setError(null);
    setMessage(null);
  }

  function validateCommonFields(): string | null {
    const normalizedEmail = safeEmail(email);
    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      return "请输入有效的邮箱地址。";
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return `密码至少需要 ${MIN_PASSWORD_LENGTH} 个字符。`;
    }
    return null;
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (emailVerificationEnabled && mode === "verify") {
      await resendVerification();
      return;
    }

    const validationError = validateCommonFields();
    if (validationError) {
      setError(validationError);
      return;
    }
    if (mode === "sign-up" && name.trim().length === 0) {
      setError("请输入你的称呼。");
      return;
    }

    setIsPending(true);
    try {
      const isSignUp = mode === "sign-up";
      const body = isSignUp
        ? {
            name: name.trim(),
            email: safeEmail(email),
            password,
            ...(emailVerificationEnabled
              ? {
                  callbackURL: `${window.location.origin}/auth?verified=1`,
                }
              : {}),
          }
        : {
            email: safeEmail(email),
            password,
            callbackURL: nextPath,
          };
      const endpoint = isSignUp
        ? "/api/auth/sign-up/email"
        : "/api/auth/sign-in/email";
      await postAuth(endpoint, body);

      if (isSignUp && emailVerificationEnabled) {
        setPassword("");
        setMode("verify");
        setMessage(
          "注册请求已受理。请检查邮箱中的验证链接；邮件未必即时送达，未收到时可以重新发送。",
        );
      } else if (isSignUp) {
        setPassword("");
        setMode("sign-in");
        setMessage("注册成功，请使用密码登录。");
      } else {
        router.replace(nextPath);
        router.refresh();
      }
    } catch (requestError) {
      setError(authErrorMessage(requestError));
    } finally {
      setIsPending(false);
    }
  }

  async function resendVerification() {
    const normalizedEmail = safeEmail(email);
    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      setError("请输入注册时使用的邮箱地址。");
      return;
    }

    setError(null);
    setMessage(null);
    setIsPending(true);
    try {
      await postAuth("/api/auth/send-verification-email", {
        email: normalizedEmail,
        callbackURL: `${window.location.origin}/auth?verified=1`,
      });
      setMessage("请求已提交。请检查邮箱，若仍未收到可稍后重试。");
    } catch (requestError) {
      setError(authErrorMessage(requestError));
    } finally {
      setIsPending(false);
    }
  }

  const isSignUp = mode === "sign-up";
  const isVerify = emailVerificationEnabled && mode === "verify";

  return (
    <section className="auth-card" aria-labelledby="auth-title">
      <div className="auth-card-heading">
        <span className="section-kicker">
          {emailVerificationEnabled ? "邮箱身份" : "账户身份"}
        </span>
        <h1 id="auth-title">
          {isVerify
            ? "验证你的邮箱"
            : isSignUp
              ? "建立你的学习路径"
              : "继续你的学习路径"}
        </h1>
        <p>
          {isVerify
            ? "邮箱验证完成后，再次登录即可恢复你的学习地图和进度。"
            : "真实来源、可验证的节点，以及只属于你的学习记录。"}
        </p>
      </div>

      {!isVerify ? (
        <div className="auth-tabs" role="tablist" aria-label="认证方式">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "sign-in"}
            className={mode === "sign-in" ? "auth-tab active" : "auth-tab"}
            onClick={() => changeMode("sign-in")}
          >
            登录
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "sign-up"}
            className={mode === "sign-up" ? "auth-tab active" : "auth-tab"}
            onClick={() => changeMode("sign-up")}
          >
            注册
          </button>
        </div>
      ) : null}

      <form className="auth-form" onSubmit={submitAuth} noValidate>
        {isSignUp ? (
          <label className="field-label">
            称呼
            <input
              className="field-input"
              type="text"
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              maxLength={80}
              required
              disabled={isPending}
            />
          </label>
        ) : null}
        <label className="field-label">
          邮箱
          <input
            className="field-input"
            type="email"
            name="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
            disabled={isPending}
          />
        </label>
        {!isVerify ? (
          <label className="field-label">
            密码
            <input
              className="field-input"
              type="password"
              name="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={isSignUp ? "new-password" : "current-password"}
              minLength={MIN_PASSWORD_LENGTH}
              required
              disabled={isPending}
            />
            <span className="field-help">
              至少 {MIN_PASSWORD_LENGTH} 个字符
            </span>
          </label>
        ) : null}

        {error ? (
          <p className="form-message form-message-error" role="alert">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className="form-message form-message-info" role="status">
            {message}
          </p>
        ) : null}

        <button
          className="button button-primary button-block"
          type="submit"
          disabled={isPending}
        >
          {isPending
            ? "处理中…"
            : isVerify
              ? "重新发送验证邮件"
              : isSignUp
                ? emailVerificationEnabled
                  ? "注册并验证邮箱"
                  : "注册"
                : "登录知径"}
        </button>
      </form>

      {isVerify ? (
        <button
          type="button"
          className="button button-secondary button-block"
          onClick={() => changeMode("sign-in")}
          disabled={isPending}
        >
          返回登录
        </button>
      ) : null}

      <div className="auth-card-footer">
        <p>登录即表示你同意只用本人 Session 访问学习内容。</p>
        <Link href="/">返回知径首页</Link>
      </div>
    </section>
  );
}

async function postAuth(
  path: string,
  body: Record<string, string>,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      credentials: "include",
      cache: "no-store",
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiRequestError(0, "network_error", "网络连接失败", null);
  }

  if (response.ok) {
    return;
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  let errorValue: unknown = payload;
  if (typeof payload === "object" && payload !== null && "error" in payload) {
    errorValue = payload.error;
  }
  let code: string | null = null;
  let message = "认证请求未完成";
  let requestId: string | null = null;
  if (typeof errorValue === "object" && errorValue !== null) {
    if ("code" in errorValue && typeof errorValue.code === "string") {
      code = errorValue.code;
    }
    if ("message" in errorValue && typeof errorValue.message === "string") {
      message = errorValue.message;
    }
    if ("requestId" in errorValue && typeof errorValue.requestId === "string") {
      requestId = errorValue.requestId;
    }
  }
  throw new ApiRequestError(response.status, code, message, requestId);
}
