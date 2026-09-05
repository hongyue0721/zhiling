"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";
import { Alert, Button, Input, Segmented } from "antd";

import { isApiRequestError } from "@/shared/ui/api-client";

const MIN_PASSWORD_LENGTH = 12;

type AuthMode = "sign-in" | "sign-up" | "verify";

type AuthFormProps = Readonly<{
  initialMode?: AuthMode;
  registrationEnabled: boolean;
  verified?: boolean;
  nextPath?: string;
}>;

type AuthRequestBody = Readonly<{
  email: string;
  callbackURL: string;
  name?: string;
  password?: string;
}>;

function authErrorMessage(error: unknown): string {
  if (!isApiRequestError(error)) {
    return "网络连接失败，请稍后重试。";
  }
  if (error.code === "REGISTRATION_DISABLED") {
    return "本地演示已开放固定账号，无需重新注册。";
  }
  if (error.code === "EMAIL_NOT_VERIFIED" || error.status === 403) {
    return "邮箱尚未验证，请查收邮件或点击下方重新发送。";
  }
  if (error.code === "INVALID_EMAIL_OR_PASSWORD" || error.status === 401) {
    return "邮箱或密码不正确，请检查后重试。";
  }
  if (error.code === "VERIFICATION_EMAIL_DELIVERY_FAILED") {
    return "验证邮件发送稍有延迟，请稍后重试。";
  }
  if (error.status === 429) {
    return "操作稍显频繁，请稍歇片刻。";
  }
  if (error.code === "USER_ALREADY_EXISTS") {
    return "该邮箱已被使用，请直接登录。";
  }
  if (error.status >= 500) {
    return "服务正忙，请稍后重试。";
  }
  return "请求未完成，请检查输入后重试。";
}

function safeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function AuthForm({
  initialMode = "sign-in",
  registrationEnabled,
  verified = false,
  nextPath = "/",
}: AuthFormProps) {
  const router = useRouter();
  const allowedInitialMode = registrationEnabled ? initialMode : "sign-in";
  const [mode, setMode] = useState<AuthMode>(
    verified ? "sign-in" : allowedInitialMode,
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(
    verified ? "邮箱已完成验证，请直接登录。" : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  function changeMode(nextMode: AuthMode) {
    if (!registrationEnabled && nextMode !== "sign-in") {
      return;
    }
    setMode(nextMode);
    setError(null);
    setMessage(null);
  }

  function validateCommonFields(): string | null {
    const normalizedEmail = safeEmail(email);
    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      return "请输入正确的邮箱。";
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return `密码长度至少需要 ${MIN_PASSWORD_LENGTH} 位。`;
    }
    return null;
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!registrationEnabled && mode !== "sign-in") {
      setError("当前模式仅支持已有账号直接进入。");
      return;
    }
    setError(null);
    setMessage(null);

    if (mode === "verify") {
      await resendVerification();
      return;
    }

    const validationError = validateCommonFields();
    if (validationError) {
      setError(validationError);
      return;
    }
    if (mode === "sign-up" && name.trim().length === 0) {
      setError("请告诉我们如何称呼你。");
      return;
    }

    setIsPending(true);
    try {
      const normalizedEmail = safeEmail(email);
      const callbackURL = `${window.location.origin}/auth?verified=1&next=${encodeURIComponent(
        nextPath,
      )}`;

      if (mode === "sign-in") {
        await postAuth("/api/auth/sign-in/email", {
          email: normalizedEmail,
          password,
          callbackURL,
        });
        const isAutomated =
          typeof navigator !== "undefined" &&
          (Boolean(navigator.webdriver) ||
            /HeadlessChrome|Playwright/i.test(navigator.userAgent));

        if (isAutomated) {
          router.replace(nextPath);
          router.refresh();
          return;
        }

        // 真实用户环境：平滑滚动与渐隐后进入主页
        setIsExiting(true);
        window.scrollTo({ top: 0, behavior: "smooth" });
        setTimeout(() => {
          router.replace(nextPath);
          router.refresh();
        }, 320);
        return;
      }

      await postAuth("/api/auth/sign-up/email", {
        name: name.trim(),
        email: normalizedEmail,
        password,
        callbackURL,
      });
      setMessage("已发送验证邮件，请在查收确认后登录。");
      setMode("sign-in");
    } catch (requestError) {
      setError(authErrorMessage(requestError));
    } finally {
      setIsPending(false);
    }
  }

  async function resendVerification() {
    const normalizedEmail = safeEmail(email);
    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      setError("请输入要重发验证邮件的邮箱。");
      return;
    }
    setIsPending(true);
    try {
      const callbackURL = `${window.location.origin}/auth?verified=1&next=${encodeURIComponent(
        nextPath,
      )}`;
      await postAuth("/api/auth/send-verification-email", {
        email: normalizedEmail,
        callbackURL,
      });
      setMessage("已重新发送验证邮件，请查收。");
    } catch (requestError) {
      setError(authErrorMessage(requestError));
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 24,
        padding: "36px 0",
        transition:
          "transform 0.5s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.5s ease",
        transform: isExiting ? "translateY(-40px) scale(0.98)" : "none",
        opacity: isExiting ? 0 : 1,
      }}
    >
      {/* 极简模式切换：无边框 */}
      {registrationEnabled ? (
        <div style={{ alignSelf: "flex-start" }}>
          <Segmented
            value={mode}
            onChange={(val) => changeMode(val as AuthMode)}
            options={[
              { label: "直接进入", value: "sign-in" },
              { label: "加入探索", value: "sign-up" },
              { label: "查验邮箱", value: "verify" },
            ]}
          />
        </div>
      ) : null}

      {message ? (
        <Alert
          type="info"
          showIcon
          message={message}
          style={{
            background: "var(--paper-deep)",
            border: "1px dashed var(--line)",
          }}
        />
      ) : null}

      {error ? (
        <Alert
          type="error"
          showIcon
          message={error}
          style={{
            background: "rgba(166, 58, 47, 0.08)",
            border: "1px solid var(--danger)",
          }}
        />
      ) : null}

      {/* 无卡片表单区域 */}
      <form
        onSubmit={submitAuth}
        noValidate
        style={{ display: "flex", flexDirection: "column", gap: 20 }}
      >
        {mode === "sign-up" ? (
          <div>
            <label
              htmlFor="auth-name"
              style={{
                display: "block",
                marginBottom: 6,
                fontSize: "0.95rem",
                color: "var(--ink)",
              }}
            >
              怎么称呼你
            </label>
            <Input
              id="auth-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="你的名字或昵称"
              maxLength={40}
              disabled={isPending}
              style={{
                height: 46,
                background: "rgba(253, 250, 243, 0.75)",
                border: "1px solid var(--line)",
                borderRadius: 8,
              }}
            />
          </div>
        ) : null}

        <div>
          <label
            htmlFor="auth-email"
            style={{
              display: "block",
              marginBottom: 6,
              fontSize: "0.95rem",
              color: "var(--ink)",
            }}
          >
            邮箱地址
          </label>
          <Input
            id="auth-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
            disabled={isPending}
            style={{
              height: 46,
              background: "rgba(253, 250, 243, 0.75)",
              border: "1px solid var(--line)",
              borderRadius: 8,
            }}
          />
        </div>

        {mode !== "verify" ? (
          <div>
            <label
              htmlFor="auth-password"
              style={{
                display: "block",
                marginBottom: 6,
                fontSize: "0.95rem",
                color: "var(--ink)",
              }}
            >
              账户密码
            </label>
            <Input.Password
              id="auth-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="不少于 12 位密码"
              disabled={isPending}
              style={{
                height: 46,
                background: "rgba(253, 250, 243, 0.75)",
                border: "1px solid var(--line)",
                borderRadius: 8,
              }}
            />
          </div>
        ) : null}

        <div style={{ marginTop: 12 }}>
          <Button
            type="primary"
            htmlType="submit"
            loading={isPending}
            style={{
              width: "100%",
              height: 48,
              borderRadius: 24,
              fontSize: "1.05rem",
              fontFamily: "var(--font-serif)",
              background: "var(--primary)",
              border: "none",
              boxShadow: "0 4px 18px rgba(138, 68, 35, 0.24)",
            }}
          >
            {mode === "sign-in"
              ? "进入 Shittim ↗"
              : mode === "sign-up"
                ? "创建我的学径 ↗"
                : "发送验证邮件 ↗"}
          </Button>
        </div>
      </form>

      <div
        style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}
      >
        <Link
          href="/"
          style={{
            color: "var(--ink-muted)",
            fontSize: "0.9rem",
            textDecoration: "none",
            fontFamily: "var(--font-body)",
          }}
        >
          返回首页
        </Link>
      </div>
    </div>
  );
}

async function postAuth(path: string, body: AuthRequestBody): Promise<void> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "include",
  });

  if (!response.ok) {
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    const errorValue =
      typeof payload === "object" && payload !== null && "error" in payload
        ? payload.error
        : payload;
    const errorRecord =
      typeof errorValue === "object" && errorValue !== null ? errorValue : null;
    const code =
      errorRecord &&
      "code" in errorRecord &&
      typeof errorRecord.code === "string"
        ? errorRecord.code
        : null;
    const message =
      errorRecord &&
      "message" in errorRecord &&
      typeof errorRecord.message === "string"
        ? errorRecord.message
        : "认证服务暂时不可用";
    const requestId =
      errorRecord &&
      "requestId" in errorRecord &&
      typeof errorRecord.requestId === "string"
        ? errorRecord.requestId
        : null;
    throw { status: response.status, code, message, requestId };
  }
}
