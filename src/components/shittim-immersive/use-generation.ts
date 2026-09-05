"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest, isApiRequestError } from "@/shared/ui/api-client";
import {
  eventStage,
  readRequest,
  readSnapshot,
  type TaskEvent,
  type TaskSnapshot,
} from "./generation-protocol";
import {
  followGeneration,
  ProgressConnectionError,
} from "./generation-transport";
import { failureText } from "./generation-copy";
export type GenerationView = {
  phase:
    | "idle"
    | "submitting"
    | "live"
    | "reconnecting"
    | "connection_error"
    | "succeeded"
    | "failed";
  topic: string;
  taskId: string | null;
  status: string;
  sequence: number;
  startedAt: number;
  lastEventAt: number;
  attempt: number;
  error: string | null;
  result: TaskSnapshot["result"];
  failure: TaskSnapshot["failure"];
  reuse: string;
  events: { sequence: number; status: string; at: number }[];
  visited: string[];
  authRequired: boolean;
};
const empty: GenerationView = {
  phase: "idle",
  topic: "",
  taskId: null,
  status: "idle",
  sequence: 0,
  startedAt: 0,
  lastEventAt: 0,
  attempt: 0,
  error: null,
  result: null,
  failure: null,
  reuse: "",
  events: [],
  visited: [],
  authRequired: false,
};
/** One task controller shared by home and /generate. Never send a new POST while reconnecting. */
export function useGeneration(accountKey: string, enabled: boolean) {
  const [view, setView] = useState<GenerationView>(empty);
  const controllerRef = useRef<AbortController | null>(null);
  const locked = useRef(false);
  const cursorRef = useRef(0);
  const storageKey = `shittim:active-generation:${encodeURIComponent(accountKey)}`;

  const getSnapshot = useCallback(
    async (taskId: string, signal: AbortSignal) => {
      const timeout = new AbortController();
      const relay = () => timeout.abort();
      signal.addEventListener("abort", relay, { once: true });
      if (signal.aborted) relay();
      const timer = setTimeout(relay, 15_000);
      try {
        const response = await apiRequest<unknown>(
          `/api/map-generations/${encodeURIComponent(taskId)}`,
          { signal: timeout.signal },
        );
        const snapshot = readSnapshot(response);
        if (snapshot.taskId !== taskId)
          throw new Error("收到另一任务的快照，已停止跳转。");
        return snapshot;
      } catch (error) {
        if (isApiRequestError(error))
          throw new ProgressConnectionError(error.message, error.status);
        throw error;
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", relay);
      }
    },
    [],
  );

  const applySnapshot = useCallback((snapshot: TaskSnapshot) => {
    if (snapshot.status === "succeeded" && !snapshot.result)
      throw new Error("地图已生成，但学习入口尚未返回。请重新连接原任务。");
    cursorRef.current = Math.max(cursorRef.current, snapshot.sequence);
    setView((current) => ({
      ...current,
      taskId: snapshot.taskId,
      status: snapshot.status,
      sequence: cursorRef.current,
      startedAt:
        Date.parse(snapshot.createdAt) || current.startedAt || Date.now(),
      lastEventAt: Date.now(),
      result: snapshot.result,
      failure: snapshot.failure,
      phase:
        snapshot.status === "succeeded"
          ? "succeeded"
          : snapshot.status === "failed"
            ? "failed"
            : "live",
      error:
        snapshot.status === "failed"
          ? (failureText[snapshot.failure?.code ?? ""] ??
            "生成未完成，原主题已保留。")
          : null,
      visited: current.visited.includes(snapshot.status)
        ? current.visited
        : [...current.visited, snapshot.status],
    }));
  }, []);

  const run = useCallback(
    async (topic: string, resumeTaskId?: string) => {
      if (locked.current && !resumeTaskId) return;
      locked.current = true;
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      if (!resumeTaskId) cursorRef.current = 0;
      setView((current) =>
        resumeTaskId
          ? {
              ...current,
              topic,
              taskId: resumeTaskId,
              phase: "reconnecting",
              error: null,
              authRequired: false,
            }
          : {
              ...empty,
              topic,
              phase: "submitting",
              status: "queued",
              startedAt: Date.now(),
            },
      );
      try {
        const requested = resumeTaskId
          ? {
              reuse: "active_task",
              snapshot: await getSnapshot(resumeTaskId, controller.signal),
            }
          : readRequest(
              await apiRequest<unknown>("/api/map-generations", {
                method: "POST",
                body: JSON.stringify({ topic }),
                signal: controller.signal,
              }),
            );
        if (controller.signal.aborted) return;
        const snapshot = requested.snapshot;
        cursorRef.current = snapshot.sequence;
        try {
          sessionStorage.setItem(
            storageKey,
            JSON.stringify({ taskId: snapshot.taskId, topic }),
          );
        } catch {
          /* storage can be unavailable */
        }
        setView((current) => ({ ...current, reuse: requested.reuse }));
        applySnapshot(snapshot);
        if (snapshot.status === "succeeded" || snapshot.status === "failed")
          return;
        await followGeneration({
          taskId: snapshot.taskId,
          initialSequence: snapshot.sequence,
          signal: controller.signal,
          readSnapshot: (signal) => getSnapshot(snapshot.taskId, signal),
          onSnapshot: (next) => {
            if (!controller.signal.aborted) applySnapshot(next);
          },
          onConnection: (phase, attempt) => {
            if (!controller.signal.aborted)
              setView((current) => ({ ...current, phase, attempt }));
          },
          onEvent: (event: TaskEvent) => {
            if (controller.signal.aborted) return;
            cursorRef.current = Math.max(cursorRef.current, event.sequence);
            const status = eventStage(event);
            setView((current) => ({
              ...current,
              sequence: cursorRef.current,
              lastEventAt: Date.now(),
              // Terminal state is committed only by canonical GET, never by animation or a partial event.
              status:
                status && status !== "succeeded" && status !== "failed"
                  ? status
                  : current.status,
              visited:
                status && !current.visited.includes(status)
                  ? [...current.visited, status]
                  : current.visited,
              events:
                status && current.events.at(-1)?.status !== status
                  ? [
                      ...current.events,
                      { sequence: event.sequence, status, at: Date.now() },
                    ].slice(-6)
                  : current.events,
            }));
          },
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        const status =
          isApiRequestError(error) || error instanceof ProgressConnectionError
            ? error.status
            : 0;
        setView((current) => ({
          ...current,
          phase: "connection_error",
          authRequired: status === 401,
          error:
            status === 401
              ? "登录状态已失效，请重新登录后继续查看这次任务。"
              : error instanceof Error
                ? error.message
                : "进度连接暂时中断。",
        }));
      } finally {
        if (controllerRef.current === controller) locked.current = false;
      }
    },
    [storageKey, getSnapshot, applySnapshot],
  );

  useEffect(() => {
    let saved: { taskId?: unknown; topic?: unknown } | null = null;
    try {
      saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
    } catch {
      /* malformed local state */
    }
    if (
      saved &&
      typeof saved.taskId === "string" &&
      typeof saved.topic === "string"
    )
      void run(saved.topic, saved.taskId);
    return () => {
      controllerRef.current?.abort();
      locked.current = false;
    };
  }, [run, storageKey]);

  const start = (topic: string) => {
    const normalized = topic.trim();
    if (!enabled || !normalized || normalized.length > 200) return;
    void run(normalized);
  };
  const reconnect = () => {
    if (view.taskId) void run(view.topic, view.taskId);
  };
  const reset = () => {
    controllerRef.current?.abort();
    locked.current = false;
    cursorRef.current = 0;
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      /* optional storage */
    }
    setView(empty);
  };
  return { view, start, reconnect, reset };
}
