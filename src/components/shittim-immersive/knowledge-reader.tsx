"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  LearningMapDetail,
  LearningAssessmentSubmissionResult,
} from "@/components/contracts";
import { QuestionSession } from "./question-session";
import { chapterNumeral, type ReadingTarget } from "./book-atlas-model";
import s from "./scenes.module.css";
const kinds: Record<string, string> = {
  consensus: "共识",
  disagreement: "辨析",
  practical_experience: "实作",
  supplementary: "补遗",
};
/** Knowledge is already in GET /map. Opening this reader makes zero provider calls. */
export function KnowledgeReader({
  relationshipId,
  map,
  target,
  onClose,
  onBusy,
  onSubmitted,
  onNavigate,
}: {
  relationshipId: string;
  map: LearningMapDetail;
  target: ReadingTarget;
  onClose: () => void;
  onBusy: (busy: boolean) => void;
  onSubmitted: (result: LearningAssessmentSubmissionResult) => void;
  onNavigate: (target: ReadingTarget) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<"read" | "practice">("read"),
    [requested, setRequested] = useState(false),
    [busy, setBusy] = useState(false);
  const node = map.nodes.find((n) => n.nodeId === target.nodeId),
    order = map.nodes.findIndex((n) => n.nodeId === target.nodeId);
  const viewpoints = map.viewpoints.filter((v) => v.nodeId === target.nodeId);
  const sources = map.sources.filter((v) =>
    node?.sourceIds.includes(v.sourceId),
  );
  const prerequisites = map.prerequisites
    .filter((e) => e.nodeId === target.nodeId)
    .flatMap((e) => {
      const n = map.nodes.find((n) => n.nodeId === e.prerequisiteNodeId);
      return n ? [n] : [];
    });
  useEffect(() => {
    setTab("read");
    const frame = requestAnimationFrame(() => {
      const element = target.refId
        ? root.current?.querySelector<HTMLElement>(
            `[data-ref="${CSS.escape(target.refId)}"]`,
          )
        : root.current;
      if (element && target.refId)
        element.scrollIntoView({ block: "start", behavior: "auto" });
    });
    return () => cancelAnimationFrame(frame);
  }, [target.nodeId, target.kind, target.refId]);
  const changeBusy = useCallback(
    (value: boolean) => {
      setBusy(value);
      onBusy(value);
    },
    [onBusy],
  );
  if (!node)
    return (
      <div className={s.knowledgeBody}>
        <p>这一章暂不可用。</p>
        <button className={s.secondary} onClick={onClose}>
          合卷
        </button>
      </div>
    );
  return (
    <div ref={root} className={s.knowledgeBody}>
      <div className={s.readerMasthead}>
        <span className={s.chapterIndex}>{chapterNumeral(order)}</span>
        <span className={s.readerChapter}>第 {order + 1} 章</span>
        <span className={s.readerEdition}>Shittim / Marginalia</span>
      </div>
      <h2 className={s.knowledgeTitle}>{node.title}</h2>
      <nav className={s.readerTabs} aria-label="篇章内容">
        <button
          type="button"
          aria-current={tab === "read" ? "page" : undefined}
          disabled={busy}
          onClick={() => setTab("read")}
        >
          读本
        </button>
        <button
          type="button"
          aria-current={tab === "practice" ? "page" : undefined}
          disabled={busy}
          onClick={() => {
            setRequested(true);
            setTab("practice");
          }}
        >
          练习
        </button>
      </nav>
      <article hidden={tab !== "read"} className={s.readingArticle}>
        <p className={s.learningObjective}>{node.learningObjective}</p>
        {prerequisites.length > 0 && (
          <div className={s.prerequisiteLine}>
            <span>前篇</span>
            {prerequisites.map((n) => (
              <button
                type="button"
                key={n.nodeId}
                onClick={() =>
                  onNavigate({ nodeId: n.nodeId, kind: "chapter" })
                }
              >
                {n.title} ↗
              </button>
            ))}
          </div>
        )}
        <div className={s.knowledgeNotes}>
          {viewpoints.map((v, index) => (
            <section
              className={s.knowledgeSection}
              data-ref={v.viewpointId}
              data-highlight={target.refId === v.viewpointId}
              key={v.viewpointId}
            >
              <span className={s.noteNumber}>
                {String(index + 1).padStart(2, "0")}
              </span>
              <div>
                <h3>{kinds[v.kind] ?? "札记"}</h3>
                <p>{v.statement}</p>
                {v.conditions && (
                  <p className={s.conditions}>
                    <span>适用条件</span>
                    {v.conditions}
                  </p>
                )}
                <div className={s.citationRow}>
                  {v.sourceIds.map((id) => {
                    const source = map.sources.find((s) => s.sourceId === id);
                    return source ? (
                      <a
                        key={id}
                        href={`#source-${id}`}
                        onClick={(event) => {
                          event.preventDefault();
                          const el =
                            root.current?.querySelector<HTMLDetailsElement>(
                              `[data-ref="${CSS.escape(id)}"]`,
                            );
                          if (el) {
                            el.open = true;
                            el.scrollIntoView({ block: "nearest" });
                          }
                        }}
                      >
                        〔{source.authorName || "引文"}〕
                      </a>
                    ) : null;
                  })}
                </div>
              </div>
            </section>
          ))}
        </div>
        {sources.length > 0 && (
          <section className={s.sourceSection}>
            <h3>引文与出处</h3>
            {sources.map((source, index) => (
              <details
                key={source.sourceId}
                data-ref={source.sourceId}
                id={`source-${source.sourceId}`}
                className={s.sourceLeaf}
                open={index === 0 || target.refId === source.sourceId}
              >
                <summary>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  {source.title}
                </summary>
                <blockquote>{source.excerpt}</blockquote>
                <div className={s.sourceCredit}>
                  <span>{source.authorName}</span>
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    原文 ↗
                  </a>
                </div>
              </details>
            ))}
          </section>
        )}
        <footer className={s.readingFooter}>
          <button type="button" className={s.secondary} onClick={onClose}>
            合卷回图
          </button>
          <button
            type="button"
            className={s.primary}
            onClick={() => {
              setRequested(true);
              setTab("practice");
            }}
          >
            读过了，试一题 <span aria-hidden="true">↗</span>
          </button>
        </footer>
      </article>
      {requested && (
        <div hidden={tab !== "practice"} className={s.readerPractice}>
          <QuestionSession
            relationshipId={relationshipId}
            nodeId={target.nodeId}
            map={map}
            onBack={() => setTab("read")}
            onBusy={changeBusy}
            onSubmitted={onSubmitted}
          />
        </div>
      )}
    </div>
  );
}
