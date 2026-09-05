"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";

import { AppHeader } from "@/components/app-header";
import {
  ApiRequestError,
  apiRequest,
  isApiRequestError,
} from "@/shared/ui/api-client";
import type {
  GenerationProgress,
  GenerationRequestResult,
  GenerationSnapshot,
  SafeGenerationEvent,
} from "@/components/contracts";

type GenerationPageProps = Readonly<{
  email: string;
  initialTopic?: string;
}>;

type GenerationFailure = Readonly<{
  code: string;
  retryable: boolean;
}>;

type GenerationState =
  | "idle"
  | "submitting"
  | "streaming"
  | "reconnecting"
  | "succeeded"
  | "failed"
  | "connection_error";

const statusLabels: Record<string, string> = {
  queued: "任务已排队",
  normalizing: "正在整理学习主题",
  cache_lookup: "正在检查可复用版本",
  planning: "正在规划学习方向",
  searching: "正在检索真实来源",
  structuring: "正在组织学习节点",
  supplementing: "正在补充材料",
  extracting: "正在提取不同观点",
  assessing: "正在生成验证题",
  validating: "正在校验地图和来源",
  publishing: "正在保存正式版本",
  succeeded: "地图已生成",
  failed: "生成未完成",
};

const generationStages = [
  "normalizing",
  "cache_lookup",
  "planning",
  "searching",
  "structuring",
  "supplementing",
  "extracting",
  "assessing",
  "validating",
  "publishing",
] as const;
const failureLabels: Record<string, string> = {
  invalid_topic: "这个主题暂时无法生成，请换一个更具体的学习目标。",
  source_unavailable: "知乎来源请求未完成，诊断日志已记录，请稍后重试。",
  source_insufficient: "当前可用材料不足，暂时无法形成可靠的学习地图。",
  model_unavailable: "结构化服务暂时不可用，请稍后再试。",
  model_output_invalid:
    "模型返回的结构化内容无效，任务没有发布不完整的学习地图。",
  candidate_invalid: "生成内容未通过质量校验，请稍后重试。",
  generation_timeout: "生成任务超时了，请稍后重新提交。",
  internal_failure: "生成任务失败，请稍后重试。",
};

function generationErrorMessage(error: unknown): string {
  if (!isApiRequestError(error)) {
    return "网络连接失败，请稍后重试。";
  }
  if (error.status === 401 || error.code === "authentication_required") {
    return "登录状态已失效，请重新登录。";
  }
  if (error.code === "invalid_request" || error.code === "invalid_topic") {
    return "请输入一个有效的学习主题。";
  }
  if (error.status === 429) {
    return "生成请求过于频繁，请稍后再试。";
  }
  if (error.status >= 500) {
    return "生成服务暂时不可用，请稍后再试。";
  }
  return "生成请求未完成，请稍后重试。";
}

function isGenerationEvent(value: unknown): value is SafeGenerationEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  if (
    !("protocolVersion" in value) ||
    value.protocolVersion !== "1" ||
    !("taskId" in value) ||
    typeof value.taskId !== "string" ||
    !("sequence" in value) ||
    typeof value.sequence !== "number" ||
    !isSafeInteger(value.sequence) ||
    !("type" in value) ||
    (value.type !== "snapshot" &&
      value.type !== "progress" &&
      value.type !== "succeeded" &&
      value.type !== "failed") ||
    !("data" in value) ||
    typeof value.data !== "object" ||
    value.data === null ||
    Array.isArray(value.data)
  ) {
    return false;
  }
  return true;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

export function readServerTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function readResult(value: unknown): GenerationSnapshot["result"] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  if (
    !("mapId" in value) ||
    !("versionId" in value) ||
    !("learningRelationshipId" in value)
  ) {
    return null;
  }
  const mapId = readString(value.mapId);
  const versionId = readString(value.versionId);
  const learningRelationshipId = readString(value.learningRelationshipId);
  return mapId && versionId && learningRelationshipId
    ? { mapId, versionId, learningRelationshipId }
    : null;
}
export function readProgress(value: unknown): GenerationProgress | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const progress: {
    model?: GenerationProgress["model"];
    search?: GenerationProgress["search"];
    supplement?: GenerationProgress["supplement"];
    recovery?: GenerationProgress["recovery"];
    reusedStages?: GenerationProgress["reusedStages"];
  } = {};
  const model =
    typeof record.model === "object" &&
    record.model !== null &&
    !Array.isArray(record.model)
      ? (record.model as Record<string, unknown>)
      : null;
  if (
    model &&
    isSafeInteger(model.attempt) &&
    model.maxAttempts === 3 &&
    model.attempt >= 1 &&
    model.attempt <= model.maxAttempts
  ) {
    progress.model = {
      attempt: model.attempt,
      maxAttempts: model.maxAttempts,
    };
  }
  const readCounts = (
    candidate: unknown,
  ): { completed: number; total: number } | undefined => {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      Array.isArray(candidate)
    ) {
      return undefined;
    }
    const counts = candidate as Record<string, unknown>;
    return isSafeInteger(counts.completed) &&
      isSafeInteger(counts.total) &&
      counts.completed >= 0 &&
      counts.total >= counts.completed
      ? { completed: counts.completed, total: counts.total }
      : undefined;
  };
  const search = readCounts(record.search);
  const supplement = readCounts(record.supplement);
  if (search) progress.search = search;
  if (supplement) progress.supplement = supplement;
  const recovery =
    typeof record.recovery === "object" &&
    record.recovery !== null &&
    !Array.isArray(record.recovery)
      ? (record.recovery as Record<string, unknown>)
      : null;
  if (
    recovery &&
    recovery.reason === "model_output_invalid" &&
    (recovery.state === "started" || recovery.state === "exhausted") &&
    isSafeInteger(recovery.attempt) &&
    recovery.maxAttempts === 3 &&
    isSafeInteger(recovery.used) &&
    recovery.limit === 3 &&
    recovery.attempt >= 1 &&
    recovery.attempt <= recovery.maxAttempts &&
    recovery.used >= 0 &&
    recovery.used <= recovery.limit
  ) {
    progress.recovery = {
      reason: "model_output_invalid",
      state: recovery.state,
      attempt: recovery.attempt,
      maxAttempts: recovery.maxAttempts,
      used: recovery.used,
      limit: recovery.limit,
    };
  }
  if (Array.isArray(record.reusedStages)) {
    const reusedStages = record.reusedStages.filter(
      (
        stage,
      ): stage is NonNullable<GenerationProgress["reusedStages"]>[number] =>
        typeof stage === "string" &&
        generationStages.some((knownStage) => knownStage === stage),
    );
    if (reusedStages.length > 0) progress.reusedStages = reusedStages;
  }
  return Object.keys(progress).length > 0 ? progress : null;
}

function extractEventProgress(
  event: SafeGenerationEvent,
): GenerationProgress | null {
  if (typeof event.data !== "object" || event.data === null) return null;
  const value = "progress" in event.data ? event.data.progress : event.data;
  return readProgress(value);
}

function readFailure(value: unknown): GenerationFailure | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  if (!("code" in value) || !("retryable" in value)) {
    return null;
  }
  const code = readString(value.code);
  return code && typeof value.retryable === "boolean"
    ? { code, retryable: value.retryable }
    : null;
}

function extractEventResult(
  event: SafeGenerationEvent,
): GenerationSnapshot["result"] {
  if (typeof event.data !== "object" || event.data === null) {
    return null;
  }
  return "result" in event.data ? readResult(event.data.result) : null;
}

function extractEventFailure(
  event: SafeGenerationEvent,
): GenerationFailure | null {
  if (typeof event.data !== "object" || event.data === null) {
    return null;
  }
  if ("failure" in event.data) {
    return readFailure(event.data.failure);
  }
  return null;
}

function extractStatus(event: SafeGenerationEvent): string | null {
  if (typeof event.data !== "object" || event.data === null) {
    return null;
  }
  if ("status" in event.data) {
    return readString(event.data.status);
  }
  if ("stage" in event.data) {
    return readString(event.data.stage);
  }
  return null;
}

function parseSseBlock(block: string): SafeGenerationEvent | null {
  let eventData = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("data:")) {
      eventData += line.slice(5).trimStart();
    }
  }
  if (!eventData) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(eventData);
    return isGenerationEvent(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function streamGeneration(
  taskId: string,
  initialSequence: number,
  signal: AbortSignal,
  onEvent: (event: SafeGenerationEvent) => void | Promise<void>,
  onReconnect: (attempt: number) => void,
  onConnected: () => void,
): Promise<void> {
  let sequence = initialSequence;
  let reconnectAttempt = 0;
  const maxReconnectAttempts = 8;

  while (!signal.aborted) {
    let response: Response;
    try {
      response = await fetch(
        `/api/map-generations/${encodeURIComponent(taskId)}/events`,
        {
          headers: {
            Accept: "text/event-stream",
            "Last-Event-ID": String(sequence),
          },
          credentials: "include",
          cache: "no-store",
          signal,
        },
      );
    } catch {
      if (signal.aborted) {
        return;
      }
      reconnectAttempt += 1;
      if (reconnectAttempt > maxReconnectAttempts) {
        throw new ApiRequestError(
          0,
          "stream_disconnected",
          "生成进度连接中断",
          null,
        );
      }
      onReconnect(reconnectAttempt);
      await waitBeforeReconnect(reconnectAttempt, signal);
      continue;
    }

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
        typeof errorValue === "object" && errorValue !== null
          ? errorValue
          : null;
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
          : "生成进度暂时不可用";
      const requestId =
        errorRecord &&
        "requestId" in errorRecord &&
        typeof errorRecord.requestId === "string"
          ? errorRecord.requestId
          : null;
      throw new ApiRequestError(response.status, code, message, requestId);
    }

    if (!response.body) {
      throw new ApiRequestError(
        0,
        "stream_disconnected",
        "生成进度连接中断",
        null,
      );
    }

    onConnected();
    reconnectAttempt = 0;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let reachedTerminal = false;
    try {
      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          const event = parseSseBlock(block);
          if (!event || event.taskId !== taskId || event.sequence <= sequence) {
            continue;
          }
          sequence = event.sequence;
          await onEvent(event);
          if (event.type === "succeeded" || event.type === "failed") {
            reachedTerminal = true;
            break;
          }
        }
        if (reachedTerminal) {
          break;
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (reachedTerminal || signal.aborted) {
      return;
    }

    reconnectAttempt += 1;
    if (reconnectAttempt > maxReconnectAttempts) {
      throw new ApiRequestError(
        0,
        "stream_disconnected",
        "生成进度连接中断",
        null,
      );
    }
    onReconnect(reconnectAttempt);
    await waitBeforeReconnect(reconnectAttempt, signal);
  }
}
export function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0
    ? `${minutes}分${String(remainder).padStart(2, "0")}秒`
    : `${remainder}秒`;
}

async function waitBeforeReconnect(
  attempt: number,
  signal: AbortSignal,
): Promise<void> {
  const delay = Math.min(8_000, 500 * 2 ** Math.max(0, attempt - 1));
  await new Promise<void>((resolve) => {
    let settled = false;
    const timeout: { id?: number } = {};
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout.id !== undefined) {
        window.clearTimeout(timeout.id);
      }
      signal.removeEventListener("abort", finish);
      resolve();
    };
    timeout.id = window.setTimeout(finish, delay);
    signal.addEventListener("abort", finish, { once: true });
  });
}

export function GenerationPage({
  email,
  initialTopic = "",
}: GenerationPageProps) {
  const router = useRouter();
  const abortRef = useRef<AbortController | null>(null);
  const lastSequenceRef = useRef(0);
  const [topic, setTopic] = useState(initialTopic);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("idle");
  const [state, setState] = useState<GenerationState>("idle");
  const [failure, setFailure] = useState<GenerationFailure | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [progress, setProgress] = useState<GenerationProgress | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (startedAt === null) {
      setElapsedMs(0);
      return;
    }
    const updateElapsed = () => {
      setElapsedMs(Math.max(0, Date.now() - startedAt));
    };
    updateElapsed();
    if (
      state === "succeeded" ||
      state === "failed" ||
      state === "connection_error"
    ) {
      return;
    }
    const interval = window.setInterval(updateElapsed, 1_000);
    return () => window.clearInterval(interval);
  }, [startedAt, state]);

  async function handleGenerationEvent(
    event: SafeGenerationEvent,
    signal: AbortSignal,
  ) {
    lastSequenceRef.current = event.sequence;
    setReconnectAttempt(0);
    setState((current) => (current === "reconnecting" ? "streaming" : current));
    const nextStatus = extractStatus(event);
    if (nextStatus) {
      setStatus(nextStatus);
    }

    const nextProgress = extractEventProgress(event);
    if (nextProgress) {
      setProgress(nextProgress);
    }

    if (event.type === "succeeded" || event.type === "failed") {
      let terminalSnapshot: GenerationSnapshot;
      try {
        terminalSnapshot = await apiRequest<GenerationSnapshot>(
          `/api/map-generations/${encodeURIComponent(event.taskId)}`,
          { method: "GET", signal },
        );
      } catch (requestError) {
        if (signal.aborted) {
          return;
        }
        setState("connection_error");
        setError(generationErrorMessage(requestError));
        return;
      }
      if (signal.aborted) {
        return;
      }
      const snapshotMatchesEvent =
        terminalSnapshot.taskId === event.taskId &&
        terminalSnapshot.sequence >= event.sequence &&
        terminalSnapshot.status === event.type;
      if (!snapshotMatchesEvent) {
        setState("connection_error");
        setError("生成服务返回了不一致的任务状态，未进入任何学习地图。");
        return;
      }
      setStatus(terminalSnapshot.status);
      if (terminalSnapshot.progress) {
        setProgress(terminalSnapshot.progress);
      }
      if (event.type === "succeeded") {
        if (terminalSnapshot.result?.learningRelationshipId) {
          setState("succeeded");
          router.replace(
            `/learn/${encodeURIComponent(
              terminalSnapshot.result.learningRelationshipId,
            )}`,
          );
        } else {
          setState("connection_error");
          setError("生成服务返回了不完整结果，未进入任何学习地图。");
        }
      } else if (terminalSnapshot.failure) {
        setFailure(terminalSnapshot.failure);
        setState("failed");
      } else {
        setState("connection_error");
        setError("生成服务返回了不完整失败信息，请稍后重试。");
      }
      return;
    }

    const eventResult = extractEventResult(event);
    if (event.type === "snapshot" && nextStatus === "succeeded") {
      if (eventResult?.learningRelationshipId) {
        setState("succeeded");
        router.replace(
          `/learn/${encodeURIComponent(eventResult.learningRelationshipId)}`,
        );
      } else {
        setState("connection_error");
        setError("生成服务返回了不完整结果，未进入任何学习地图。");
      }
      return;
    }

    if (event.type === "snapshot" && nextStatus === "failed") {
      const eventFailure = extractEventFailure(event);
      if (eventFailure) {
        setFailure(eventFailure);
        setState("failed");
      } else {
        setState("connection_error");
        setError("生成服务返回了不完整失败信息，请稍后重试。");
      }
    }
  }

  async function submitGeneration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedTopic = topic.trim();
    setError(null);
    setFailure(null);
    if (!normalizedTopic) {
      setError("请输入你想系统学习的主题。");
      return;
    }
    if (normalizedTopic.length > 200) {
      setError("主题不能超过 200 个字符。");
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState("submitting");
    setStatus("queued");
    setTaskId(null);
    lastSequenceRef.current = 0;
    setReconnectAttempt(0);
    setStartedAt(null);
    setElapsedMs(0);
    setProgress(null);

    try {
      const response = await apiRequest<GenerationRequestResult>(
        "/api/map-generations",
        {
          method: "POST",
          body: JSON.stringify({ topic: normalizedTopic }),
          signal: controller.signal,
        },
      );
      const snapshot = response.snapshot;
      if (!snapshot.taskId) {
        setState("connection_error");
        setError("生成服务没有返回有效任务，请稍后重试。");
        return;
      }
      const serverStartedAt = readServerTimestamp(snapshot.createdAt);
      if (serverStartedAt !== null) {
        setStartedAt(serverStartedAt);
        setElapsedMs(Math.max(0, Date.now() - serverStartedAt));
      }
      setTaskId(snapshot.taskId);
      if (snapshot.progress) {
        setProgress(snapshot.progress);
      }
      lastSequenceRef.current = snapshot.sequence;
      setStatus(snapshot.status);
      const snapshotResult = snapshot.result;
      if (snapshot.status === "succeeded") {
        if (snapshotResult?.learningRelationshipId) {
          setState("succeeded");
          router.replace(
            `/learn/${encodeURIComponent(snapshotResult.learningRelationshipId)}`,
          );
        } else {
          setState("connection_error");
          setError("生成服务返回了不完整结果，未进入任何学习地图。");
        }
        return;
      }
      if (snapshot.status === "failed") {
        if (snapshot.failure) {
          setFailure(snapshot.failure);
          setState("failed");
        } else {
          setState("connection_error");
          setError("生成服务返回了不完整失败信息，请稍后重试。");
        }
        return;
      }

      setState("streaming");
      await streamGeneration(
        snapshot.taskId,
        snapshot.sequence,
        controller.signal,
        (event) => handleGenerationEvent(event, controller.signal),
        (attempt) => {
          setReconnectAttempt(attempt);
          setState("reconnecting");
        },
        () => {
          setReconnectAttempt(0);
          setState((current) =>
            current === "reconnecting" ? "streaming" : current,
          );
        },
      );
    } catch (requestError) {
      if (controller.signal.aborted) {
        return;
      }
      if (
        isApiRequestError(requestError) &&
        (requestError.status === 401 ||
          requestError.code === "authentication_required")
      ) {
        router.replace(`/auth?next=${encodeURIComponent("/generate")}`);
        return;
      }
      if (
        isApiRequestError(requestError) &&
        requestError.code === "stream_disconnected"
      ) {
        setState("connection_error");
        setError("生成进度连接多次中断。可以重新连接以恢复任务，或稍后重试。");
        return;
      }
      setState("connection_error");
      setError(generationErrorMessage(requestError));
    }
  }

  function reconnectTask() {
    if (!taskId) {
      return;
    }
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setError(null);
    setFailure(null);
    setState("streaming");
    void streamGeneration(
      taskId,
      lastSequenceRef.current,
      controller.signal,
      (event) => handleGenerationEvent(event, controller.signal),
      (attempt) => {
        setReconnectAttempt(attempt);
        setState("reconnecting");
      },
      () => {
        setReconnectAttempt(0);
        setState((current) =>
          current === "reconnecting" ? "streaming" : current,
        );
      },
    ).catch((requestError: unknown) => {
      if (controller.signal.aborted) {
        return;
      }
      setState("connection_error");
      setError(
        isApiRequestError(requestError) &&
          requestError.code === "stream_disconnected"
          ? "生成进度连接仍未恢复，请稍后重试。"
          : generationErrorMessage(requestError),
      );
    });
  }

  const statusLabel = statusLabels[status] ?? "正在处理";
  const failureLabel = failure
    ? (failureLabels[failure.code] ?? "生成任务未能完成，请稍后重试。")
    : null;

  const currentStageIndex = generationStages.findIndex(
    (stage) => stage === status,
  );
  const reusedStages = progress?.reusedStages ?? [];
  const modelProgress = progress?.model;
  const searchProgress = progress?.search;
  const supplementProgress = progress?.supplement;
  const recoveryProgress = progress?.recovery;
  const isBusy =
    state === "submitting" || state === "streaming" || state === "reconnecting";

  return (
    <div className="app-frame">
      <AppHeader email={email} eyebrow="现场生成" />
      <main className="generation-main">
        <div className="generation-heading">
          <Link className="back-link" href="/">
            ← 我的学习
          </Link>
          <span className="section-kicker">现场生成</span>
          <h1>从一个问题，建立一张可验证的地图。</h1>
          <p>
            生成任务只在服务端使用真实来源和受控模型。未经校验的内容不会提前展示，任务可以在连接中断后恢复。
          </p>
        </div>

        <section
          className="generation-layout"
          aria-labelledby="generation-form-title"
        >
          <div className="generation-form-card">
            <div className="panel-heading">
              <h2 id="generation-form-title">你的学习目标</h2>
              <p>尽量写清楚你想理解的范围，最多 200 个字符。</p>
            </div>
            <form
              className="generation-form"
              onSubmit={submitGeneration}
              noValidate
            >
              <label className="field-label" htmlFor="generation-topic">
                学习主题
                <textarea
                  id="generation-topic"
                  className="field-input field-textarea"
                  value={topic}
                  onChange={(event) => {
                    setTopic(event.target.value);
                    if (error) setError(null);
                  }}
                  maxLength={200}
                  rows={4}
                  placeholder="例如：如何为高流量网站设计可靠的缓存系统"
                  disabled={isBusy}
                />
              </label>
              <div className="field-counter" aria-live="polite">
                {topic.length}/200
              </div>
              {error ? (
                <p className="form-message form-message-error" role="alert">
                  {error}
                </p>
              ) : null}
              <button
                className="button button-primary button-block"
                type="submit"
                disabled={isBusy}
              >
                {isBusy ? "任务进行中…" : "开始现场生成"}
              </button>
            </form>
            <p className="privacy-note">
              你的主题会随当前正式 Session 提交；前端不会发送用户
              ID，也不会接收候选正文或供应方错误详情。
            </p>
          </div>

          <section
            className="generation-status-card"
            aria-labelledby="generation-status-title"
          >
            <div className="status-card-topline">
              <span className="section-kicker">任务状态</span>
              {taskId ? <span className="status-live">可恢复</span> : null}
            </div>
            <h2 id="generation-status-title">
              {state === "idle" ? "准备开始" : statusLabel}
            </h2>
            {state === "idle" ? (
              <p className="status-card-description">
                提交后，这里会按服务端事件显示规范化、检索、结构化和校验进度。
              </p>
            ) : state === "reconnecting" ? (
              <p className="status-card-description" role="status">
                连接暂时中断，正在用 Last-Event-ID 恢复进度（第{" "}
                {reconnectAttempt} 次尝试）。
              </p>
            ) : state === "connection_error" ? (
              <p className="status-card-description" role="alert">
                {error ?? "进度连接暂时不可用。"}
              </p>
            ) : state === "failed" ? (
              <div className="generation-failure" role="alert">
                <strong>{failureLabel}</strong>
                <p>
                  {failure?.retryable === true
                    ? "该失败标记为可重试，你可以重新提交主题。"
                    : failure?.retryable === false
                      ? "任务已安全终止，未发布不完整的学习地图；诊断日志已记录。"
                      : "失败原因尚未确认，请稍后重新提交主题。"}
                </p>
              </div>
            ) : (
              <div className="generation-progress">
                <div className="progress-track">
                  <span className="progress-indicator" />
                </div>
                <div
                  className="generation-progress-live"
                  role="status"
                  aria-live="polite"
                >
                  <p>{statusLabel}</p>
                  {recoveryProgress ? (
                    <p className="progress-recovery">
                      {recoveryProgress.state === "started"
                        ? `将执行第 ${recoveryProgress.attempt}/${recoveryProgress.maxAttempts} 次模型尝试（全局恢复预算 ${recoveryProgress.used}/${recoveryProgress.limit}）`
                        : "自动恢复预算已耗尽，未发布不完整地图"}
                    </p>
                  ) : null}
                </div>
                <div className="generation-stage-list" aria-label="生成阶段">
                  {generationStages.map((stage, index) => {
                    const reused = reusedStages.includes(stage);
                    const complete =
                      reused ||
                      (currentStageIndex >= 0 && index < currentStageIndex);
                    const active = status === stage;
                    return (
                      <span
                        className={`generation-stage ${
                          complete
                            ? "generation-stage-complete"
                            : active
                              ? "generation-stage-active"
                              : ""
                        }`}
                        key={stage}
                      >
                        <span aria-hidden="true">
                          {complete ? "✓" : index + 1}
                        </span>
                        {statusLabels[stage]}
                      </span>
                    );
                  })}
                </div>
                <div className="generation-progress-facts">
                  <span>已用时 {formatElapsed(elapsedMs)}</span>
                  {modelProgress ? (
                    <span>
                      模型尝试 {modelProgress.attempt}/
                      {modelProgress.maxAttempts}
                    </span>
                  ) : null}
                  {searchProgress ? (
                    <span>
                      搜索方向 {searchProgress.completed}/{searchProgress.total}
                    </span>
                  ) : null}
                  {supplementProgress ? (
                    <span>
                      补充材料 {supplementProgress.completed}/
                      {supplementProgress.total}
                    </span>
                  ) : null}
                </div>
                {reusedStages.length > 0 ? (
                  <span className="progress-caption">
                    已复用阶段结果：
                    {reusedStages
                      .map((stage) => statusLabels[stage])
                      .join("、")}
                  </span>
                ) : (
                  <span className="progress-caption">
                    事件来自服务端，断线会自动恢复
                  </span>
                )}
              </div>
            )}
            {state === "connection_error" && taskId ? (
              <button
                type="button"
                className="button button-secondary"
                onClick={reconnectTask}
              >
                重新连接任务
              </button>
            ) : null}
            {state === "failed" ? (
              <button
                type="button"
                className="button button-secondary"
                onClick={() => {
                  setState("idle");
                  setFailure(null);
                  setError(null);
                  setTaskId(null);
                  setStatus("idle");
                  setProgress(null);
                  setStartedAt(null);
                }}
              >
                重新提交主题
              </button>
            ) : null}
          </section>
        </section>
      </main>
    </div>
  );
}
