"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiRequest, isApiRequestError } from "@/shared/ui/api-client";
import type {
  LearningMapDetail,
  LearningProgressSummary,
  LearningAssessmentSubmissionResult,
} from "./contracts";
import { AnonBookmark } from "./shittim-immersive/bookish-chrome";
import { FlowHeader } from "./shittim-immersive/flow-header";
import { Scene, Scanner } from "./shittim-immersive/scene";
import { ImmersiveAtlas } from "./shittim-immersive/immersive-atlas";
import { KnowledgeReader } from "./shittim-immersive/knowledge-reader";
import { Overlay } from "./shittim-immersive/dialog";
import type { ReadingTarget } from "./shittim-immersive/book-atlas-model";
import s from "./shittim-immersive/scenes.module.css";
type LearningWorkspaceProps = Readonly<{
  relationshipId: string;
  email: string;
  initialNodeId?: string;
}>;
export function LearningWorkspace({
  relationshipId,
  email,
  initialNodeId,
}: LearningWorkspaceProps) {
  const router = useRouter();
  const [map, setMap] = useState<LearningMapDetail | null>(null),
    [progress, setProgress] = useState<LearningProgressSummary | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [progressError, setProgressError] = useState("");
  const [target, setTarget] = useState<ReadingTarget | null>(null),
    [readerOpen, setReaderOpen] = useState(false),
    [drawer, setDrawer] = useState(false);
  const [paused, setPaused] = useState(false),
    [checking, setChecking] = useState(false),
    [pulse, setPulse] = useState(0),
    [reload, setReload] = useState(0);
  const progressRequest = useRef<AbortController | null>(null);
  const handleAuth = useCallback(
    (value: unknown) => {
      if (isApiRequestError(value) && value.status === 401) {
        router.replace(
          `/auth?next=${encodeURIComponent(`/learn/${relationshipId}`)}`,
        );
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
    const timer = setTimeout(() => controller.abort(), 20000);
    setProgressError("");
    try {
      const value = await apiRequest<LearningProgressSummary>(
        `/api/learning-relationships/${encodeURIComponent(relationshipId)}/progress`,
        { signal: controller.signal },
      );
      if (progressRequest.current === controller && !controller.signal.aborted)
        setProgress(value);
    } catch (value) {
      if (progressRequest.current === controller && !handleAuth(value))
        setProgressError("进度暂未同步。");
    } finally {
      clearTimeout(timer);
    }
  }, [relationshipId, handleAuth]);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timer = setTimeout(() => controller.abort(), 20000);
    setMap(null);
    setProgress(null);
    setTarget(null);
    setReaderOpen(false);
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
        if (
          initialNodeId &&
          value.nodes.some((n) => n.nodeId === initialNodeId)
        ) {
          setTarget({ nodeId: initialNodeId, kind: "chapter" });
          setReaderOpen(true);
        }
      })
      .catch((value) => {
        if (active && !handleAuth(value)) setError("地图暂时未能加载。");
      })
      .finally(() => {
        clearTimeout(timer);
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
      progressRequest.current?.abort();
      progressRequest.current = null;
    };
  }, [relationshipId, initialNodeId, reload, handleAuth, refreshProgress]);
  const completed = useMemo(
    () =>
      new Set(
        progress?.nodes.filter((n) => n.completed).map((n) => n.nodeId) ?? [],
      ),
    [progress],
  );
  const count = map?.nodes.filter((n) => completed.has(n.nodeId)).length ?? 0;
  function choose(next: ReadingTarget) {
    setDrawer(false);
    setTarget(next);
    setReaderOpen(true);
    setPulse((p) => p + 1);
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
                  ? {
                      ...n,
                      completed: true,
                      bestScore: Math.max(n.bestScore, result.bestScore),
                    }
                  : n,
              ),
            }
          : current,
      );
    }
    void refreshProgress();
  }
  return (
    <main className={s.viewport} data-screen="map" data-paused={paused}>
      <Scene
        mode={checking ? "checking" : "map"}
        paused={paused}
        pulse={pulse}
      />
      <FlowHeader
        active={readerOpen ? "reading" : "map"}
        email={email}
        paused={paused}
        onPause={() => setPaused((v) => !v)}
        onMap={() => {
          if (!checking) setReaderOpen(false);
        }}
        onRead={target ? () => setReaderOpen(true) : undefined}
      />
      {loading ? (
        <div className={s.loadingCenter}>
          <Scanner label="展开地图" />
        </div>
      ) : !map?.nodes.length ? (
        <section className={s.emptyState}>
          <h1>地图暂不可用</h1>
          <p className={s.error} role="alert">
            {error}
          </p>
          <button className={s.primary} onClick={() => setReload((r) => r + 1)}>
            重新展开 ↻
          </button>
        </section>
      ) : (
        <>
          <section className={s.mapMeta} aria-label="本卷题签">
            <div className={s.titleSlip}>
              <span className={s.titleRubric}>
                学习手札 <i aria-hidden="true">/</i> Vol. 01
              </span>
              <h1 title={map.title}>{map.title}</h1>
            </div>
            <span className={s.metaOrnament} aria-hidden="true">
              Curiosity, inscribed.
            </span>
          </section>
          <ImmersiveAtlas
            map={map}
            completed={completed}
            selected={target?.nodeId ?? null}
            onSelect={choose}
            pulse={pulse}
          />
          <button
            className={s.edgeTab}
            onClick={() => setDrawer(true)}
            aria-expanded={drawer}
          >
            目录
          </button>
        </>
      )}
      <AnonBookmark />
      <Overlay
        open={drawer}
        drawer
        title="学习目录与进度"
        onClose={() => setDrawer(false)}
      >
        <div className={s.drawerBody}>
          <span className={s.eyebrow}>Contents</span>
          <h2>本卷目录</h2>
          {progress && map ? (
            <>
              <div className={s.progressNumber}>
                {count}
                <small> / {map.nodes.length}</small>
              </div>
              <div
                className={s.progressBar}
                role="progressbar"
                aria-label="完成练习的核心章节"
                aria-valuenow={count}
                aria-valuemin={0}
                aria-valuemax={map.nodes.length}
              >
                <i style={{ width: `${(count / map.nodes.length) * 100}%` }} />
              </div>
            </>
          ) : progressError ? (
            <p className={s.error} role="alert">
              {progressError}
            </p>
          ) : (
            <Scanner compact label="同步目录" />
          )}
          {progressError && (
            <button
              className={s.secondary}
              onClick={() => void refreshProgress()}
            >
              重新同步 ↻
            </button>
          )}
          <ol className={s.progressNodes}>
            {map?.nodes.map((node) => (
              <li key={node.nodeId}>
                <button
                  onClick={() =>
                    choose({ nodeId: node.nodeId, kind: "chapter" })
                  }
                >
                  {node.title}
                  <span>{completed.has(node.nodeId) ? "已阅" : "未检验"}</span>
                </button>
              </li>
            ))}
          </ol>
          <Link
            className={s.primary}
            href={`/learn/${encodeURIComponent(relationshipId)}/report`}
          >
            学习报告 ↗
          </Link>
        </div>
      </Overlay>
      <Overlay
        open={readerOpen}
        keepMounted
        title="篇章知识与练习"
        busy={checking}
        onClose={() => {
          if (!checking) setReaderOpen(false);
        }}
      >
        {target && map && (
          <KnowledgeReader
            key={`${relationshipId}:${target.nodeId}`}
            relationshipId={relationshipId}
            map={map}
            target={target}
            onClose={() => setReaderOpen(false)}
            onBusy={setChecking}
            onSubmitted={submitted}
            onNavigate={choose}
          />
        )}
      </Overlay>
    </main>
  );
}
