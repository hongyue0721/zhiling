"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useGeneration } from "./use-generation";
import { statusText, generationMode } from "./generation-copy";
import { clock } from "./atlas-model";
import { Scene } from "./scene";
import { Signature, AnonBookmark } from "./bookish-chrome";
import { LibraryDrawer } from "./library-drawer";
import { FlowHeader } from "./flow-header";
import { Overlay } from "./dialog";
import s from "./scenes.module.css";
export type ImmersiveGenerationProps = Readonly<{
  email: string;
  generationRequestsEnabled?: boolean;
  initialTopic?: string;
}>;
export function ImmersiveGeneration({
  email,
  generationRequestsEnabled = true,
  initialTopic = "",
}: ImmersiveGenerationProps) {
  const router = useRouter(),
    { view, start, reconnect, reset } = useGeneration(
      email,
      generationRequestsEnabled,
    );
  const [library, setLibrary] = useState(false);
  const [topic, setTopic] = useState(initialTopic),
    [drawer, setDrawer] = useState(false),
    [paused, setPaused] = useState(false),
    [pulse, setPulse] = useState(0),
    [now, setNow] = useState(0),
    [formError, setFormError] = useState(""),
    [cover, setCover] = useState(false);
  const idle = view.phase === "idle",
    ready = view.phase === "succeeded",
    live = ["submitting", "live", "reconnecting"].includes(view.phase),
    showCover = idle || cover;
  const enterMap = () => {
    if (view.result)
      router.push(
        `/learn/${encodeURIComponent(view.result.learningRelationshipId)}`,
      );
  };
  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!idle) {
      setCover(false);
      return;
    }
    if (!topic.trim()) {
      setFormError("写下一个主题");
      return;
    }
    setCover(false);
    setFormError("");
    start(topic);
  }
  const stateLabel =
    view.phase === "reconnecting"
      ? "正在重连"
      : view.phase === "connection_error"
        ? "卷页暂时失联"
        : (statusText[view.status] ?? "正在成卷");
  return (
    <main
      className={s.viewport}
      data-paused={paused}
      data-screen={showCover ? "home" : "generation"}
    >
      {!showCover && (
        <Scene
          mode={
            ready ? "success" : live ? generationMode(view.status) : "ambient"
          }
          paused={paused}
          pulse={pulse}
        />
      )}
      <FlowHeader
        active={showCover ? "home" : "generation"}
        email={email}
        paused={paused}
        onPause={() => setPaused((v) => !v)}
        onHome={() => setCover(true)}
        onGeneration={!idle ? () => setCover(false) : undefined}
        onMap={ready ? enterMap : undefined}
      />
      {showCover ? (
        <section className={s.landing}>
          <div className={s.coverType}>
            <span className={s.coverRubric}>A small book of discoveries</span>
            <Signature large />
            <h1>从好奇，翻开这一页。</h1>
            <form onSubmit={submit} className={s.topicForm}>
              <label htmlFor="immersive-topic" className={s.srOnly}>
                想探索的主题
              </label>
              <input
                id="immersive-topic"
                value={idle ? topic : view.topic}
                onChange={(e) => setTopic(e.target.value)}
                readOnly={!idle}
                placeholder="今天，想弄明白什么？"
                maxLength={200}
                disabled={idle && !generationRequestsEnabled}
              />
              <button
                className={s.primary}
                disabled={idle && !generationRequestsEnabled}
                type="submit"
              >
                {idle ? "启卷" : "续卷"} <span aria-hidden="true">↗</span>
              </button>
            </form>
            {formError && (
              <p className={s.error} role="alert">
                {formError}
              </p>
            )}
            {idle && generationRequestsEnabled ? (
              <div className={s.suggestions}>
                {["STM32 中断", "AI Agent", "摄影构图"].map((text) => (
                  <button
                    type="button"
                    key={text}
                    onClick={() => setTopic(text)}
                  >
                    {text}
                  </button>
                ))}
              </div>
            ) : idle ? (
              <button className={s.secondary} onClick={() => setLibrary(true)}>
                翻阅精选 ↗
              </button>
            ) : ready ? (
              <button
                type="button"
                className={s.secondary}
                onClick={() => {
                  reset();
                  setCover(false);
                  setTopic("");
                }}
              >
                另起一页
              </button>
            ) : null}
          </div>
          <div className={s.coverArtwork} aria-hidden="true">
            <Scene mode="generating" paused={paused} pulse={pulse} />
            <span className={s.coverCaption}>Between the lines.</span>
          </div>
          <div className={s.coverFoot}>
            <span>什亭之匣</span>
            <i />
            <span>把讨论，走成一条学会的路。</span>
          </div>
        </section>
      ) : (
        <section className={s.generationCenter}>
          <div className={s.generationTitle}>
            <span className={s.titleRubric}>In the making</span>
            <h1>{view.topic}</h1>
          </div>
          <button
            type="button"
            className={s.orbitTouch}
            aria-label="轻拂书页墨尘"
            onClick={() => setPulse((p) => p + 1)}
          />
          <div className={s.generationStatus}>
            <p className={s.status} role="status">
              <i data-active={live} aria-hidden="true" />
              {stateLabel}
            </p>
            {view.progress?.search && view.progress.search.total > 0 && (
              <p className={s.progressFacts}>
                检索来源{" "}
                {Math.min(
                  view.progress.search.completed,
                  view.progress.search.total,
                )}{" "}
                / {view.progress.search.total}
              </p>
            )}
            {view.progress?.recovery && (
              <p className={s.progressFacts}>
                模型恢复 {view.progress.recovery.used} /{" "}
                {view.progress.recovery.limit}
              </p>
            )}
            {ready && view.result && (
              <button className={s.primary} onClick={enterMap}>
                展开图谱 ↗
              </button>
            )}
            {view.error && (
              <p className={s.error} role="alert">
                {view.error}
              </p>
            )}
            {view.phase === "connection_error" &&
              !view.authRequired &&
              view.taskId && (
                <button className={s.primary} onClick={reconnect}>
                  续接原卷 ↻
                </button>
              )}
            {view.authRequired && (
              <Link href="/auth?next=%2Fgenerate" className={s.primary}>
                重新登录 ↗
              </Link>
            )}
            {!live && !ready && (
              <button
                className={s.secondary}
                onClick={() => {
                  setTopic(view.topic);
                  reset();
                }}
              >
                返回起笔
              </button>
            )}
            {ready && view.reuse === "cache" && (
              <span className={s.cacheLabel}>已生成的卷册 · 缓存</span>
            )}
          </div>
        </section>
      )}
      {!showCover && (
        <button
          className={s.edgeTab}
          onClick={() => setDrawer(true)}
          aria-expanded={drawer}
        >
          卷录
        </button>
      )}
      <AnonBookmark />
      <LibraryDrawer open={library} onClose={() => setLibrary(false)} />
      <Overlay
        open={drawer}
        drawer
        title="生成进度"
        onClose={() => setDrawer(false)}
      >
        <div className={s.drawerBody}>
          <span className={s.eyebrow}>In the making</span>
          <h2>成卷记录</h2>
          <p className={s.drawerTopic}>{view.topic}</p>
          <strong className={s.elapsed}>
            {clock((now || Date.now()) - view.startedAt)}
          </strong>
          <ol className={s.stageList}>
            {view.visited
              .filter((value) => value !== "idle")
              .map((value) => (
                <li key={value} data-current={value === view.status}>
                  {statusText[value] ?? value}
                </li>
              ))}
          </ol>
          {view.taskId && (
            <details className={s.details}>
              <summary>任务编号</summary>
              <code>{view.taskId}</code>
            </details>
          )}
        </div>
      </Overlay>
    </main>
  );
}
