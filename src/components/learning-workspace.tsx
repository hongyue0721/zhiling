"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { apiRequest, isApiRequestError } from "@/shared/ui/api-client";
import type {
  LearningMapDetail,
  LearningProgressSummary,
  LearningAssessmentSubmissionResult,
} from "@/components/contracts";
import { Signature, BookThemeToggle, AnonBookmark } from "./shittim-immersive/bookish-chrome";
import { Scene, Scanner } from "./shittim-immersive/scene";
import { ImmersiveAtlas } from "./shittim-immersive/immersive-atlas";
import { QuestionSession } from "./shittim-immersive/question-session";
import { Overlay } from "./shittim-immersive/dialog";
import s from "./shittim-immersive/scenes.module.css";

type LearningWorkspaceProps = Readonly<{
  relationshipId: string;
  email: string;
  initialNodeId?: string;
}>;

function workspaceErrorMessage(error: unknown): string {
  if (!isApiRequestError(error)) {
    return "网络连接失败，请稍后重试。";
  }
  if (error.status === 401 || error.code === "authentication_required") {
    return "登录状态已失效，请重新登录。";
  }
  if (error.code === "resource_not_found" || error.status === 404) {
    return "这张学习地图暂时不可用，或已不属于当前账户。";
  }
  if (error.status >= 500) {
    return "学习地图暂时无法加载，请稍后重试。";
  }
  return "学习地图暂时无法加载，请稍后重试。";
}

/** /learn/[relationshipId] is the whole map: node click opens questions, progress hides in a drawer. */
export function LearningWorkspace({
  relationshipId,
  email,
  initialNodeId,
}: LearningWorkspaceProps) {
  const router = useRouter();
  const screen = useRef<HTMLElement>(null);
  const [map, setMap] = useState<LearningMapDetail | null>(null);
  const [progress, setProgress] = useState<LearningProgressSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [progressError, setProgressError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [questionOpen, setQuestionOpen] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [paused, setPaused] = useState(false);
  const [checking, setChecking] = useState(false);
  const [pulse, setPulse] = useState(0);
  const [reload, setReload] = useState(0);
  const [notice, setNotice] = useState("");
  const progressRequest = useRef<AbortController | null>(null);

  const handleAuth = useCallback(
    (value: unknown) => {
      if (isApiRequestError(value) && value.status === 401) {
        router.replace(`/auth?next=${encodeURIComponent(`/learn/${relationshipId}`)}`);
        return true;
      }
      return false;
    },
    [relationshipId, router],
  );

  const refreshProgress = useCallback(async () => {
    progressRequest.current?.abort();
    const controller = new AbortController();
    progressRequest.current = controller;
    const timeout = setTimeout(() => controller.abort(), 20000);
    setProgressError("");
    try {
      const value = await apiRequest<LearningProgressSummary>(
        `/api/learning-relationships/${encodeURIComponent(relationshipId)}/progress`,
        { signal: controller.signal },
      );
      if (progressRequest.current === controller && !controller.signal.aborted) {
        setProgress(value);
      }
    } catch (value) {
      if (progressRequest.current === controller && !handleAuth(value)) {
        setProgressError("进度暂未同步。");
      }
    } finally {
      clearTimeout(timeout);
    }
  }, [relationshipId, handleAuth]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 20000);
    setMap(null);
    setProgress(null);
    setSelected(null);
    setQuestionOpen(false);
    setDrawer(false);
    setChecking(false);
    setLoading(true);
    setError("");
    void refreshProgress();
    apiRequest<LearningMapDetail>(
      `/api/learning-relationships/${encodeURIComponent(relationshipId)}/map`,
      { signal: controller.signal },
    )
      .then((value) => {
        if (!active) return;
        setMap(value);
        if (initialNodeId && value.nodes.some((n) => n.nodeId === initialNodeId)) {
          setSelected(initialNodeId);
          setQuestionOpen(true);
        }
      })
      .catch((value) => {
        if (active && !handleAuth(value)) setError(workspaceErrorMessage(value));
      })
      .finally(() => {
        clearTimeout(timeout);
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
      progressRequest.current?.abort();
      progressRequest.current = null;
    };
  }, [relationshipId, initialNodeId, reload, handleAuth, refreshProgress]);

  const completed = useMemo(
    () => new Set((progress?.nodes ?? []).filter((n) => n.completed).map((n) => n.nodeId)),
    [progress],
  );
  const count = map?.nodes.filter((n) => completed.has(n.nodeId)).length ?? 0;

  function choose(id: string) {
    setDrawer(false);
    setSelected(id);
    setQuestionOpen(true);
  }

  function submitted(result: LearningAssessmentSubmissionResult) {
    if (result.completed) {
      setPulse((p) => p + 1);
      setProgress((current) =>
        current
          ? {
              ...current,
              nodes: current.nodes.map((n) =>
                n.nodeId === result.nodeId
                  ? { ...n, completed: true, bestScore: Math.max(n.bestScore, result.bestScore) }
                  : n,
              ),
            }
          : current,
      );
    }
    void refreshProgress();
  }

  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (screen.current?.requestFullscreen) await screen.current.requestFullscreen();
      else setNotice("浏览器暂不支持全屏。");
    } catch {
      setNotice("浏览器暂不支持全屏。");
    }
  }

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(id);
  }, [notice]);

  return (
    <main ref={screen} className={s.viewport} data-screen="map" data-paused={paused}>
      <Scene mode={checking ? "checking" : "map"} paused={paused} pulse={pulse} />
      <header className={s.topbar}>
        <Link href="/" className={s.brand}>
          <span className={s.brandMark} aria-hidden="true">什</span>
          <Signature />
        </Link>
        <div className={s.topActions}>
          <BookThemeToggle />
          <button
            type="button"
            className={`${s.tool} ${s.motionButton}`}
            title={paused ? "播放动效" : "暂停动效"}
            aria-label={paused ? "播放动效" : "暂停动效"}
            onClick={() => setPaused((p) => !p)}
            aria-pressed={paused}
          >
            <span aria-hidden="true">{paused ? "▷" : "Ⅱ"}</span>
            <span className={s.motionText}>动效</span>
          </button>
          <button type="button" className={`${s.tool} ${s.fullScreenButton}`} onClick={() => void fullscreen()}>
            ⛶ 全屏
          </button>
          <Link className={s.quietButton} href="/" title={email}>
            我的地图 ↗
          </Link>
        </div>
      </header>

      {loading ? (
        <div className={s.loadingCenter}>
          <Scanner label="展开地图" />
        </div>
      ) : !map?.nodes.length ? (
        <section className={s.emptyState}>
          <h1>地图暂不可用</h1>
          <p className={s.error} role="alert">
            {error || "服务没有返回可展示的学习节点。"}
          </p>
          <button className={s.primary} onClick={() => setReload((r) => r + 1)}>
            重新加载 ↻
          </button>
          <Link className={s.secondary} href="/">返回首页</Link>
        </section>
      ) : (
        <>
          <div className={s.mapTitle}>
            <span className={s.eyebrow}>A little atlas · 学习地图</span>
            <h1 title={map.title}>{map.title}</h1>
          </div>
          <ImmersiveAtlas
            map={map}
            completed={completed}
            selected={selected}
            onSelect={choose}
            pulse={pulse}
          />
          <button className={s.edgeTab} onClick={() => setDrawer(true)} aria-expanded={drawer}>
            <span aria-hidden="true">☷</span> 进度
          </button>
        </>
      )}

      <AnonBookmark />
      {notice ? (
        <p className={s.notice} role="status">{notice}</p>
      ) : null}

      <Overlay
        open={drawer}
        drawer
        title="学习进度"
        onClose={() => setDrawer(false)}
      >
        <div className={s.drawerBody}>
          <span className={s.eyebrow}>我的旅程</span>
          <h2>学习进度</h2>
          {progress && map ? (
            <>
              <div className={s.progressNumber}>
                {count}
                <small> / {map.nodes.length}</small>
              </div>
              <div
                className={s.progressBar}
                role="progressbar"
                aria-label="已完成节点"
                aria-valuenow={count}
                aria-valuemin={0}
                aria-valuemax={map.nodes.length}
              >
                <i style={{ width: `${(count / map.nodes.length) * 100}%` }} />
              </div>
            </>
          ) : progressError ? (
            <p className={s.error} role="alert">{progressError}</p>
          ) : (
            <Scanner compact label="同步进度" />
          )}
          {progressError && progress ? (
            <p className={s.error} role="alert">{progressError}</p>
          ) : null}
          {progressError ? (
            <button className={s.secondary} onClick={() => void refreshProgress()}>
              重新同步 ↻
            </button>
          ) : null}
          <ul className={s.progressNodes}>
            {map?.nodes.map((node) => (
              <li key={node.nodeId}>
                <button onClick={() => choose(node.nodeId)}>
                  {node.title}
                  <span aria-label={completed.has(node.nodeId) ? "已完成" : "未完成"}>
                    {completed.has(node.nodeId) ? "✓" : "↗"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <Link className={s.primary} href={`/learn/${encodeURIComponent(relationshipId)}/report`}>
            查看报告 ↗
          </Link>
        </div>
      </Overlay>

      <Overlay
        open={questionOpen}
        keepMounted
        title="节点问题"
        busy={checking}
        onClose={() => {
          if (!checking) setQuestionOpen(false);
        }}
      >
        {selected && map ? (
          <QuestionSession
            key={`${relationshipId}:${selected}`}
            relationshipId={relationshipId}
            nodeId={selected}
            map={map}
            onBack={() => setQuestionOpen(false)}
            onBusy={setChecking}
            onSubmitted={submitted}
          />
        ) : null}
      </Overlay>
    </main>
  );
}
