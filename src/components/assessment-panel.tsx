"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Form,
  Progress,
  Radio,
  Select,
  Skeleton,
  Tag,
} from "antd";

import styles from "./learning-experience.module.css";

import {
  apiRequest,
  createIdempotencyKey,
  isApiRequestError,
} from "@/shared/ui/api-client";
import type {
  AssessmentAnswerSubmission,
  AssessmentQuestionPrompt,
  LearningAssessmentSubmissionResult,
  LearningMapDetail,
} from "@/components/contracts";

type AssessmentPanelProps = Readonly<{
  relationshipId: string;
  nodeId: string;
  map: LearningMapDetail;
  onBack: () => void;
  onSubmitted: () => void;
}>;

type AssessmentResponse = Readonly<{
  learningRelationshipId: string;
  questionSetId: string;
  versionId: string;
  nodeId: string;
  questions: readonly AssessmentQuestionPrompt[];
}>;

type SelectionState = Readonly<Record<string, readonly string[]>>;
type MatchingState = Readonly<Record<string, Readonly<Record<string, string>>>>;

function assessmentErrorMessage(error: unknown): string {
  if (!isApiRequestError(error)) {
    return "网络连接失败，请稍后重试。";
  }
  if (error.status === 401 || error.code === "authentication_required") {
    return "登录状态已失效，请重新登录。";
  }
  if (error.code === "resource_not_found" || error.status === 404) {
    return "该节点的验证题目暂时不可用。";
  }
  if (error.status >= 500) {
    return "题目服务暂时不可用，请稍后重试。";
  }
  return "提交内容不符合要求，请检查每道题后重试。";
}

function sourceTitle(sourceId: string, map: LearningMapDetail): string {
  const source = map.sources.find(
    (candidate) => candidate.sourceId === sourceId,
  );
  return source?.title ?? "来源条目";
}

function matchingOptions(question: AssessmentQuestionPrompt): {
  left: readonly AssessmentQuestionPrompt["options"][number][];
  right: readonly AssessmentQuestionPrompt["options"][number][];
} {
  return {
    left: question.options.filter((option) => option.side === "left"),
    right: question.options.filter((option) => option.side === "right"),
  };
}
function questionTypeLabel(question: AssessmentQuestionPrompt): string {
  switch (question.type) {
    case "single_choice":
      return "单选题";
    case "multiple_choice":
      return "多选题";
    case "matching":
      return "匹配题";
    case "opinion_analysis":
      return "观点辨析";
  }
  return question.type;
}

function questionTypeHint(question: AssessmentQuestionPrompt): string {
  switch (question.type) {
    case "single_choice":
      return "选择一个最符合题意的选项";
    case "multiple_choice":
      return "选择所有符合题意的选项";
    case "matching":
      return "把左侧概念与右侧关系对应起来";
    case "opinion_analysis":
      return "根据已读观点判断陈述";
  }
  return question.type;
}

export function AssessmentPanel({
  relationshipId,
  nodeId,
  map,
  onBack,
  onSubmitted,
}: AssessmentPanelProps) {
  const [assessment, setAssessment] = useState<AssessmentResponse | null>(null);
  const [selection, setSelection] = useState<SelectionState>({});
  const [matching, setMatching] = useState<MatchingState>({});
  const [result, setResult] =
    useState<LearningAssessmentSubmissionResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadAssessment() {
      setIsLoading(true);
      setError(null);
      try {
        const response = await apiRequest<AssessmentResponse>(
          `/api/learning-relationships/${encodeURIComponent(relationshipId)}/nodes/${encodeURIComponent(nodeId)}/assessment`,
        );
        if (!cancelled) {
          setAssessment(response);
          setSelection({});
          setMatching({});
          setResult(null);
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(assessmentErrorMessage(requestError));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }
    void loadAssessment();
    return () => {
      cancelled = true;
    };
  }, [nodeId, relationshipId]);

  const resultByQuestionId = useMemo(
    () =>
      new Map(
        (result?.questions ?? []).map((questionResult) => [
          questionResult.questionId,
          questionResult,
        ]),
      ),
    [result],
  );
  const answerProgress = useMemo(() => {
    const total = assessment?.questions.length ?? 0;
    const answered =
      assessment?.questions.reduce((count, question) => {
        if (question.type === "matching") {
          return (
            count +
            (Object.keys(matching[question.questionId] ?? {}).length > 0
              ? 1
              : 0)
          );
        }
        return (
          count + ((selection[question.questionId] ?? []).length > 0 ? 1 : 0)
        );
      }, 0) ?? 0;
    return {
      answered,
      total,
      percent: total > 0 ? Math.round((answered / total) * 100) : 0,
    };
  }, [assessment, matching, selection]);

  function toggleSelection(
    questionId: string,
    optionId: string,
    multiple: boolean,
  ) {
    setSelection((current) => {
      const existing = [...(current[questionId] ?? [])];
      if (multiple) {
        const next = existing.includes(optionId)
          ? existing.filter((value) => value !== optionId)
          : [...existing, optionId];
        return { ...current, [questionId]: next };
      }
      return { ...current, [questionId]: [optionId] };
    });
  }

  function updateMatch(
    questionId: string,
    leftOptionId: string,
    rightOptionId: string,
  ) {
    setMatching((current) => ({
      ...current,
      [questionId]: {
        ...(current[questionId] ?? {}),
        [leftOptionId]: rightOptionId,
      },
    }));
  }

  function buildAnswers(): readonly AssessmentAnswerSubmission[] | null {
    if (!assessment) {
      return null;
    }
    const answers: AssessmentAnswerSubmission[] = [];
    for (const question of assessment.questions) {
      if (question.type === "matching") {
        const matches = Object.entries(matching[question.questionId] ?? {})
          .filter(([, rightOptionId]) => rightOptionId.length > 0)
          .map(([leftOptionId, rightOptionId]) => ({
            leftOptionId,
            rightOptionId,
          }));
        if (matches.length === 0) {
          return null;
        }
        answers.push({ questionId: question.questionId, matches });
        continue;
      }
      const selectedOptionIds = selection[question.questionId] ?? [];
      if (selectedOptionIds.length === 0) {
        return null;
      }
      answers.push({ questionId: question.questionId, selectedOptionIds });
    }
    return answers;
  }

  async function submitAssessment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const answers = buildAnswers();
    if (!answers) {
      setError("请先完成每一道题，再提交答案。");
      return;
    }
    setIsSubmitting(true);
    try {
      const submission = await apiRequest<LearningAssessmentSubmissionResult>(
        `/api/learning-relationships/${encodeURIComponent(relationshipId)}/nodes/${encodeURIComponent(nodeId)}/assessment`,
        {
          method: "POST",
          headers: { "Idempotency-Key": createIdempotencyKey("assessment") },
          body: JSON.stringify({ answers }),
        },
      );
      setResult(submission);
      onSubmitted();
    } catch (requestError) {
      setError(assessmentErrorMessage(requestError));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <section
        className={`panel-card assessment-panel ${styles.assessmentExperience}`}
        aria-busy="true"
        aria-label="正在加载题目"
      >
        <div className="panel-back-link">← 返回节点</div>
        <Skeleton active paragraph={{ rows: 7 }} />
      </section>
    );
  }

  if (!assessment) {
    return (
      <section
        className={`panel-card assessment-panel ${styles.assessmentExperience}`}
        aria-labelledby="assessment-error-title"
      >
        <Button type="text" className="panel-back-link" onClick={onBack}>
          ← 返回节点
        </Button>
        <Alert
          role="alert"
          type="error"
          message={<h2 id="assessment-error-title">题目暂时不可用</h2>}
          description={error ?? "服务没有返回可展示的题面。"}
        />
      </section>
    );
  }

  return (
    <section
      className={`panel-card assessment-panel ${styles.assessmentExperience}`}
      aria-labelledby="assessment-title"
    >
      <Button type="text" className="panel-back-link" onClick={onBack}>
        ← 返回节点
      </Button>
      <div className="panel-heading">
        <span className="section-kicker">节点验证</span>
        <h2 id="assessment-title">完成这组题，确认你真的掌握了</h2>
      </div>
      <div
        className={styles.assessmentProgress}
        aria-label={`答题进度 ${answerProgress.answered}/${answerProgress.total}`}
      >
        <div className={styles.assessmentProgressHeader}>
          <span>验证进度</span>
          <strong>
            {answerProgress.answered}/{answerProgress.total} 题
          </strong>
        </div>
        <Progress
          percent={answerProgress.percent}
          showInfo={false}
          strokeColor="var(--experience-blue)"
          trailColor="var(--experience-blue-soft)"
        />
      </div>

      <Form className="assessment-form" onSubmitCapture={submitAssessment}>
        {assessment.questions.map((question, questionIndex) => {
          const questionResult = resultByQuestionId.get(question.questionId);
          const isMultiple = question.type === "multiple_choice";
          return (
            <fieldset
              className={`question-block ${styles.questionBlock} ${
                questionResult
                  ? questionResult.correct
                    ? styles.questionCorrect
                    : styles.questionIncorrect
                  : ""
              }`}
              data-question-type={question.type}
              key={question.questionId}
            >
              <legend>
                <span className={`question-number ${styles.questionNumber}`}>
                  {questionIndex + 1}
                </span>
                <span className={styles.questionPrompt}>{question.prompt}</span>
              </legend>
              <div className={styles.questionMeta}>
                <p className="question-kind">{questionTypeLabel(question)}</p>
                <span className={styles.questionHint}>
                  {questionTypeHint(question)}
                </span>
              </div>
              {question.type === "matching" ? (
                <MatchingQuestion
                  question={question}
                  values={matching[question.questionId] ?? {}}
                  disabled={result !== null || isSubmitting}
                  onChange={(leftOptionId, rightOptionId) =>
                    updateMatch(
                      question.questionId,
                      leftOptionId,
                      rightOptionId,
                    )
                  }
                />
              ) : (
                <div className={`option-list ${styles.optionList}`}>
                  {question.options.map((option) => {
                    const checked = (
                      selection[question.questionId] ?? []
                    ).includes(option.optionId);
                    const optionProps = {
                      name: question.questionId,
                      value: option.optionId,
                      checked,
                      onChange: () =>
                        toggleSelection(
                          question.questionId,
                          option.optionId,
                          isMultiple,
                        ),
                      disabled: result !== null || isSubmitting,
                      className: `option-row ${styles.optionRow} ${checked ? "checked" : ""}`,
                    };
                    return isMultiple ? (
                      <Checkbox key={option.optionId} {...optionProps}>
                        {option.label}
                      </Checkbox>
                    ) : (
                      <Radio key={option.optionId} {...optionProps}>
                        {option.label}
                      </Radio>
                    );
                  })}
                </div>
              )}
              <div className={`question-sources ${styles.questionSources}`}>
                <span>依据来源：</span>
                {question.sourceIds.map((sourceId) => (
                  <Tag color="blue" key={`${question.questionId}:${sourceId}`}>
                    {sourceTitle(sourceId, map)}
                  </Tag>
                ))}
              </div>
              {questionResult ? (
                <Alert
                  className={`question-result ${styles.questionResult} ${
                    questionResult.correct
                      ? styles.questionResultCorrect
                      : styles.questionResultIncorrect
                  }`}
                  type={questionResult.correct ? "success" : "error"}
                  showIcon
                  message={questionResult.correct ? "回答正确" : "这次未答对"}
                  description={
                    <div>
                      <p>{questionResult.explanation}</p>
                      <div className="question-result-sources">
                        {questionResult.sourceIds.map((sourceId) => (
                          <Tag
                            color="blue"
                            key={`${question.questionId}:result:${sourceId}`}
                          >
                            {sourceTitle(sourceId, map)}
                          </Tag>
                        ))}
                      </div>
                    </div>
                  }
                />
              ) : null}
            </fieldset>
          );
        })}

        {error ? (
          <Alert
            className={`form-message ${styles.formMessage}`}
            role="alert"
            type="error"
            showIcon
            message={error}
          />
        ) : null}

        {result ? (
          <div
            className={`assessment-result ${styles.assessmentResult} ${
              result.completed
                ? styles.assessmentResultComplete
                : styles.assessmentResultPending
            }`}
            role="status"
          >
            <div className="assessment-result-score">
              <span className="result-label">本次节点得分</span>
              <strong>{Math.round(result.nodeScore / 100)}%</strong>
              <Progress
                percent={Math.round(result.nodeScore / 100)}
                status={result.completed ? "success" : "active"}
                showInfo={false}
              />
            </div>
            <p>
              {result.completed
                ? "服务端已记录该节点完成。"
                : "服务端已保存本次尝试；达到完成标准后会标记完成。"}
            </p>
            <Button type="default" onClick={onBack}>
              返回地图
            </Button>
          </div>
        ) : (
          <Button
            className={`button button-primary button-block ${styles.submitButton}`}
            type="primary"
            htmlType="submit"
            block
            loading={isSubmitting}
          >
            提交答案
          </Button>
        )}
      </Form>
    </section>
  );
}

type MatchingQuestionProps = Readonly<{
  question: AssessmentQuestionPrompt;
  values: Readonly<Record<string, string>>;
  disabled: boolean;
  onChange: (leftOptionId: string, rightOptionId: string) => void;
}>;

function MatchingQuestion({
  question,
  values,
  disabled,
  onChange,
}: MatchingQuestionProps) {
  const { left, right } = matchingOptions(question);
  return (
    <div className={`matching-list ${styles.matchingList}`}>
      {left.map((leftOption) => (
        <label
          className={`matching-row ${styles.matchingRow}`}
          key={leftOption.optionId}
        >
          <span>{leftOption.label}</span>
          <Select
            className={`field-input ${styles.matchingSelect}`}
            aria-label={`${leftOption.label}的对应项`}
            virtual={false}
            value={values[leftOption.optionId] || undefined}
            placeholder="选择对应项"
            options={right
              .filter(
                (rightOption) => rightOption.optionId !== leftOption.optionId,
              )
              .map((rightOption) => ({
                value: rightOption.optionId,
                label: rightOption.label,
              }))}
            onChange={(rightOptionId) =>
              onChange(leftOption.optionId, rightOptionId)
            }
            disabled={disabled}
          />
        </label>
      ))}
    </div>
  );
}
