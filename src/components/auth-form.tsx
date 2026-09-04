"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";
import { Alert, Button, Form, Input, Segmented } from "antd";
import styles from "./shell-experience.module.css";

import { ApiRequestError, isApiRequestError } from "@/shared/ui/api-client";

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
    return "本地演示只开放固定账号登录，不会注册账户或发送验证邮件。";
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
    verified ? "邮箱已验证，请使用密码登录。" : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

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
      return "请输入有效的邮箱地址。";
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return `密码至少需要 ${MIN_PASSWORD_LENGTH} 个字符。`;
    }
    return null;
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!registrationEnabled && mode !== "sign-in") {
      setError("本地演示只开放固定账号登录，不会注册账户或发送验证邮件。");
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
      setError("请输入你的称呼。");
      return;
    }

    setIsPending(true);
    try {
      const body =
        mode === "sign-up"
          ? {
              name: name.trim(),
              email: safeEmail(email),
              password,
              callbackURL: `${window.location.origin}/auth?verified=1`,
            }
          : {
              email: safeEmail(email),
              password,
              callbackURL: nextPath,
            };
      const endpoint =
        mode === "sign-up"
          ? "/api/auth/sign-up/email"
          : "/api/auth/sign-in/email";
      await postAuth(endpoint, body);

      if (mode === "sign-up") {
        setPassword("");
        setMode("verify");
        setMessage(
          "注册请求已受理。请检查邮箱中的验证链接；邮件未必即时送达，未收到时可以重新发送。",
        );
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
  const isVerify = mode === "verify";
  return (
    <section
      className={`${styles.authCard} auth-card`}
      aria-labelledby="auth-title"
      data-reveal
    >
      <div className={`${styles.authCardHeading} auth-card-heading`}>
        <span className={styles.authKicker}>邮箱身份</span>
        <h1 id="auth-title">
          {isVerify
            ? "验证你的邮箱"
            : isSignUp
              ? "建立你的学习路径"
              : "继续你的学习路径"}
        </h1>
        <p>
          {isVerify
            ? "邮箱验证完成后，再次登录即可恢复学习进度。"
            : "登录后继续你的学习地图与节点进度。"}
        </p>
      </div>
      {!registrationEnabled ? (
        <Alert
          className={`${styles.formMessage} form-message`}
          type="info"
          showIcon
          message="本地演示只开放固定账号登录，不会注册账户或发送验证邮件。"
        />
      ) : null}

      {!isVerify && registrationEnabled ? (
        <Segmented
          className={`${styles.authTabs} auth-tabs`}
          aria-label="认证方式"
          block
          value={mode}
          options={[
            { label: "登录", value: "sign-in" },
            { label: "注册", value: "sign-up" },
          ]}
          onChange={(value) => changeMode(value as AuthMode)}
        />
      ) : null}

      <Form
        className={`${styles.authForm} auth-form`}
        onSubmitCapture={submitAuth}
        noValidate
      >
        {isSignUp ? (
          <label className={styles.fieldLabel}>
            称呼
            <Input
              className={`${styles.fieldInput} field-input`}
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
        <label className={styles.fieldLabel}>
          邮箱
          <Input
            className={`${styles.fieldInput} field-input`}
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
          <label className={styles.fieldLabel}>
            密码
            <Input
              className={`${styles.fieldInput} field-input`}
              type="password"
              name="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={isSignUp ? "new-password" : "current-password"}
              minLength={MIN_PASSWORD_LENGTH}
              required
              disabled={isPending}
            />
            <span className={styles.fieldHelp}>
              至少 {MIN_PASSWORD_LENGTH} 个字符
            </span>
          </label>
        ) : null}

        {error ? (
          <Alert
            className={`${styles.formMessage} form-message`}
            type="error"
            showIcon
            message={error}
          />
        ) : null}
        {message ? (
          <Alert
            className={`${styles.formMessage} form-message`}
            type="info"
            showIcon
            message={message}
          />
        ) : null}

        <Button
          className={`${styles.authPrimaryButton} button button-primary button-block`}
          type="primary"
          htmlType="submit"
          block
          loading={isPending}
        >
          {isVerify
            ? "重新发送验证邮件"
            : isSignUp
              ? "注册并验证邮箱"
              : "登录知径"}
        </Button>
      </Form>

      {isVerify ? (
        <Button
          type="default"
          className={`${styles.authSecondaryButton} button button-secondary button-block`}
          onClick={() => changeMode("sign-in")}
          disabled={isPending}
          block
        >
          返回登录
        </Button>
      ) : null}

      <div className={`${styles.authCardFooter} auth-card-footer`}>
        <Link href="/">返回知径首页</Link>
      </div>
    </section>
  );
}

async function postAuth(path: string, body: AuthRequestBody): Promise<void> {
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
