"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  apiRequest,
  createIdempotencyKey,
  isApiRequestError,
} from "@/shared/ui/api-client";
import type {
  AssessmentQuestionPrompt,
  LearningAssessmentSubmissionResult,
  LearningMapDetail,
} from "@/components/contracts";
import {
  buildAnswers,
  isAnswered,
  type Picks,
  type Pairs,
} from "./atlas-model";
import { Scanner } from "./scene";
import s from "./scenes.module.css";
type Assessment = Readonly<{
  learningRelationshipId: string;
  questionSetId: string;
  versionId: string;
  nodeId: string;
  questions: readonly AssessmentQuestionPrompt[];
}>;
export function QuestionSession({
  relationshipId,
  nodeId,
  map,
  onBack,
  onBusy,
  onSubmitted,
}: {
  relationshipId: string;
  nodeId: string;
  map: LearningMapDetail;
  onBack: () => void;
  onBusy: (busy: boolean) => void;
  onSubmitted: (result: LearningAssessmentSubmissionResult) => void;
}) {
  const router = useRouter();
  const [assessment, setAssessment] = useState<Assessment | null>(null),
    [loading, setLoading] = useState(true),
    [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(""),
    [index, setIndex] = useState(0),
    [picks, setPicks] = useState<Picks>({}),
    [pairs, setPairs] = useState<Pairs>({});
  const [result, setResult] =
      useState<LearningAssessmentSubmissionResult | null>(null),
    [tab, setTab] = useState<"questions" | "materials">("questions"),
    [revision, setRevision] = useState(0);
  const request = useRef<AbortController | null>(null),
    sendLock = useRef(false),
    submissionKey = useRef<{ body: string; key: string } | null>(null);
  const path = `/api/learning-relationships/${encodeURIComponent(relationshipId)}/nodes/${encodeURIComponent(nodeId)}/assessment`;
  const errorText = useCallback(
    (value: unknown) => {
      if (isApiRequestError(value) && value.status === 401) {
        router.replace(
          `/auth?next=${encodeURIComponent(`/learn/${relationshipId}`)}`,
        );
        return "请重新登录。";
      }
      if (value instanceof Error && value.name === "AbortError")
        return "暂未确认结果，请重试。";
      return "请求未完成，请重试。";
    },
    [relationshipId, router],
  );
  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 20000);
    let active = true;
    setLoading(true);
    setError("");
    apiRequest<Assessment>(path, { signal: controller.signal })
      .then((value) => {
        if (!active) return;
        if (
          value.learningRelationshipId !== relationshipId ||
          value.nodeId !== nodeId ||
          !value.questions.length
        )
          throw new Error("Invalid assessment response");
        setAssessment(value);
        setIndex(0);
        setPicks({});
        setPairs({});
        setResult(null);
      })
      .catch((value) => {
        if (active) setError(errorText(value));
      })
      .finally(() => {
        clearTimeout(timeout);
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [path, relationshipId, nodeId, revision, errorText]);
  useEffect(
    () => () => {
      request.current?.abort();
      onBusy(false);
    },
    [onBusy],
  );
  const node = map.nodes.find((value) => value.nodeId === nodeId);
  const questions = assessment?.questions ?? [],
    question = questions[index];
  const nodeSources = map.sources.filter((source) =>
    node?.sourceIds.includes(source.sourceId),
  );
  function select(optionId: string) {
    if (!question) return;
    setPicks((current) => {
      const old = current[question.questionId] ?? [];
      const next =
        question.type === "multiple_choice"
          ? old.includes(optionId)
            ? old.filter((id) => id !== optionId)
            : [...old, optionId]
          : [optionId];
      return { ...current, [question.questionId]: next };
    });
    setError("");
  }
  async function submit() {
    if (sendLock.current || !assessment) return;
    const answers = buildAnswers(assessment.questions, picks, pairs);
    if (!answers) {
      setIndex(
        Math.max(
          0,
          questions.findIndex((q) => !isAnswered(q, picks, pairs)),
        ),
      );
      setError("请完成这一题。");
      return;
    }
    const body = JSON.stringify({ answers });
    if (submissionKey.current?.body !== body)
      submissionKey.current = { body, key: createIdempotencyKey("assessment") };
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 20000);
    sendLock.current = true;
    setSubmitting(true);
    onBusy(true);
    setError("");
    try {
      const response = await apiRequest<LearningAssessmentSubmissionResult>(
        path,
        {
          method: "POST",
          headers: { "Idempotency-Key": submissionKey.current.key },
          body,
          signal: controller.signal,
        },
      );
      if (
        response.nodeId !== nodeId ||
        response.learningRelationshipId !== relationshipId
      )
        throw new Error("Unexpected result");
      setResult(response);
      setIndex(0);
      onSubmitted(response);
    } catch (value) {
      setError(errorText(value));
    } finally {
      clearTimeout(timeout);
      sendLock.current = false;
      setSubmitting(false);
      onBusy(false);
    }
  }
  const header = (
    <div className={s.questionTop}>
      <strong>{node?.title ?? "节点问题"}</strong>
      {assessment && (
        <span className={s.questionCounter}>
          {index + 1} / {questions.length}
        </span>
      )}
    </div>
  );
  if (loading)
    return (
      <div className={s.questionBody}>
        {header}
        <Scanner label="展开问题" />
      </div>
    );
  if (!assessment || !question)
    return (
      <div className={s.questionBody}>
        {header}
        <p className={s.error} role="alert">
          {error || "题目暂不可用。"}
        </p>
        <button className={s.primary} onClick={() => setRevision((r) => r + 1)}>
          重新加载
        </button>
      </div>
    );
  if (submitting)
    return (
      <div
        className={`${s.questionBody} ${s.checkingBackdrop}`}
        aria-busy="true"
      >
        {header}
        <Scanner label="正在检测" />
      </div>
    );
  const answerResult = result?.questions.find(
    (q) => q.questionId === question.questionId,
  );
  return (
    <div className={s.questionBody}>
      {header}
      <div className={s.questionTabs}>
        <button
          aria-pressed={tab === "questions"}
          onClick={() => setTab("questions")}
        >
          {result ? "结果" : "题目"}
        </button>
        <button
          aria-pressed={tab === "materials"}
          onClick={() => setTab("materials")}
        >
          先学一下
        </button>
      </div>
      {tab === "materials" ? (
        <section className={s.materials}>
          <h3>{node?.title}</h3>
          <p>{node?.learningObjective}</p>
          {map.viewpoints
            .filter((v) => v.nodeId === nodeId)
            .map((v) => (
              <p key={v.viewpointId}>
                {v.statement}
                {v.conditions ? `（${v.conditions}）` : ""}
              </p>
            ))}
          {nodeSources.map((source) => (
            <details className={s.details} key={source.sourceId}>
              <summary>{source.title}</summary>
              <p>{source.excerpt}</p>
              <a href={source.url} target="_blank" rel="noopener noreferrer">
                阅读原文 ↗
              </a>
              <small>{source.authorName}</small>
            </details>
          ))}
          <button className={s.secondary} onClick={() => setTab("questions")}>
            返回题目 →
          </button>
        </section>
      ) : result ? (
        <section>
          <div
            className={s.resultIcon}
            data-success={result.completed}
            aria-hidden="true"
          >
            {result.completed ? "✓" : "↗"}
          </div>
          <h2 className={s.resultTitle}>
            {result.completed ? "节点已点亮" : "本次已记录"}
          </h2>
          <span className={s.resultScore}>
            本次 {Math.round(result.nodeScore / 100)}%
          </span>
          <div className={s.resultReview}>
            <h3>
              {answerResult?.correct ? "✓" : "○"} {question.prompt}
            </h3>
            <details className={s.details}>
              <summary>查看解析</summary>
              <p>{answerResult?.explanation ?? "暂无解析。"}</p>
              {map.sources
                .filter((source) =>
                  answerResult?.sourceIds.includes(source.sourceId),
                )
                .map((source) => (
                  <a
                    key={source.sourceId}
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {source.title} ↗
                  </a>
                ))}
            </details>
          </div>
          <div className={s.questionNav}>
            <button
              className={s.secondary}
              onClick={() => {
                setResult(null);
                setPicks({});
                setPairs({});
                setIndex(0);
                submissionKey.current = null;
              }}
            >
              再试一轮
            </button>
            <button
              className={s.primary}
              onClick={
                index < questions.length - 1
                  ? () => setIndex((i) => i + 1)
                  : onBack
              }
            >
              {index < questions.length - 1 ? "下一题解析 →" : "回到读本 ↗"}
            </button>
          </div>
        </section>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (index < questions.length - 1) {
              if (isAnswered(question, picks, pairs)) {
                setIndex((i) => i + 1);
                setError("");
              } else setError("请选择答案。");
            } else void submit();
          }}
        >
          <h2 className={s.questionPrompt}>{question.prompt}</h2>
          <span className={s.questionKind}>
            {question.type === "multiple_choice"
              ? "多选"
              : question.type === "matching"
                ? "配对"
                : question.type === "opinion_analysis"
                  ? "观点辨析"
                  : "单选"}
          </span>
          {question.type === "matching" ? (
            <div>
              {question.options
                .filter((o) => o.side === "left")
                .map((left) => (
                  <label className={s.matchingRow} key={left.optionId}>
                    <span>{left.label}</span>
                    <select
                      aria-label={`匹配：${left.label}`}
                      value={pairs[question.questionId]?.[left.optionId] ?? ""}
                      onChange={(event) => {
                        const value = event.target.value;
                        setPairs((current) => ({
                          ...current,
                          [question.questionId]: {
                            ...current[question.questionId],
                            [left.optionId]: value,
                          },
                        }));
                        setError("");
                      }}
                    >
                      <option value="">选择对应项</option>
                      {question.options
                        .filter((o) => o.side === "right")
                        .map((right) => (
                          <option key={right.optionId} value={right.optionId}>
                            {right.label}
                          </option>
                        ))}
                    </select>
                  </label>
                ))}
            </div>
          ) : (
            <fieldset className={s.options}>
              <legend className={s.srOnly}>选择答案</legend>
              {question.options.map((option, i) => (
                <label key={option.optionId} className={s.option}>
                  <input
                    type={
                      question.type === "multiple_choice" ? "checkbox" : "radio"
                    }
                    name={question.questionId}
                    value={option.optionId}
                    checked={(picks[question.questionId] ?? []).includes(
                      option.optionId,
                    )}
                    onChange={() => select(option.optionId)}
                  />
                  <span className={s.optionLetter} aria-hidden="true">
                    {String.fromCharCode(65 + i)}
                  </span>
                  <span className={s.optionText}>{option.label}</span>
                </label>
              ))}
            </fieldset>
          )}
          {error && (
            <p className={s.error} role="alert">
              {error}
            </p>
          )}
          <div className={s.questionNav}>
            <button
              className={s.secondary}
              type="button"
              onClick={
                index
                  ? () => {
                      setIndex((i) => i - 1);
                      setError("");
                    }
                  : onBack
              }
            >
              {index ? "上一题" : "回到读本"}
            </button>
            <div className={s.stepDots} aria-hidden="true">
              {questions.map((q, i) => (
                <i key={q.questionId} data-current={i === index} />
              ))}
            </div>
            <button className={s.primary} type="submit">
              {index < questions.length - 1 ? "下一题 →" : "检测答案 ↗"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
