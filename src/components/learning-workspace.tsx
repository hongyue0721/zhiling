"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Empty, Progress, Segmented, Skeleton, Tag } from "antd";

import { AppHeader } from "@/components/app-header";
import { AssessmentPanel } from "@/components/assessment-panel";
import {
  LearningMapCanvas,
  type QuestionSatellite,
} from "@/components/learning-map-canvas";
import styles from "./learning-experience.module.css";
import { apiRequest, isApiRequestError } from "@/shared/ui/api-client";
import type {
  LearningMapDetail,
  LearningProgressSummary,
} from "@/components/contracts";

type LearningWorkspaceProps = Readonly<{
  relationshipId: string;
  email: string;
  initialNodeId?: string;
}>;

type SidebarTab = "content" | "digest" | "assessment";
type WorkspaceView = "canvas" | "timeline";

type AssessmentQuestionRaw = Readonly<{
  questionId: string;
  type: string;
  prompt: string;
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

export function LearningWorkspace({
  relationshipId,
  email,
  initialNodeId,
}: LearningWorkspaceProps) {
  const router = useRouter();
  const [map, setMap] = useState<LearningMapDetail | null>(null);
  const [progress, setProgress] = useState<LearningProgressSummary | null>(
    null,
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assessmentOpen, setAssessmentOpen] = useState(false);
  const [isRefreshingProgress, setIsRefreshingProgress] = useState(false);

  // 视图控制与三栏 Tab
  const [viewMode, setViewMode] = useState<WorkspaceView>("canvas");
  const [activeTab, setActiveTab] = useState<SidebarTab>("content");
  const [nodeQuestionsMap, setNodeQuestionsMap] = useState<
    Record<string, QuestionSatellite[]>
  >({});

  const workspaceRequestGenerationRef = useRef(0);
  const workspaceAbortControllerRef = useRef<AbortController | null>(null);
  const progressRequestGenerationRef = useRef(0);
  const progressAbortControllerRef = useRef<AbortController | null>(null);

  const loadWorkspace = useCallback(async () => {
    const generation = workspaceRequestGenerationRef.current + 1;
    workspaceRequestGenerationRef.current = generation;
    workspaceAbortControllerRef.current?.abort();
    const controller = new AbortController();
    workspaceAbortControllerRef.current = controller;

    setIsLoading(true);
    setError(null);
    try {
      const [mapResponse, progressResponse] = await Promise.all([
        apiRequest<LearningMapDetail>(
          `/api/learning-relationships/${encodeURIComponent(relationshipId)}/map`,
          { signal: controller.signal },
        ),
        apiRequest<LearningProgressSummary>(
          `/api/learning-relationships/${encodeURIComponent(relationshipId)}/progress`,
          { signal: controller.signal },
        ),
      ]);
      if (
        workspaceRequestGenerationRef.current !== generation ||
        controller.signal.aborted
      ) {
        return;
      }
      setMap(mapResponse);
      setProgress(progressResponse);
      setSelectedNodeId((current) => {
        if (
          current &&
          mapResponse.nodes.some((node) => node.nodeId === current)
        ) {
          return current;
        }
        if (
          initialNodeId &&
          mapResponse.nodes.some((node) => node.nodeId === initialNodeId)
        ) {
          return initialNodeId;
        }
        return (
          mapResponse.nodes
            .slice()
            .sort((left, right) => left.nodeId.localeCompare(right.nodeId))[0]
            ?.nodeId ?? null
        );
      });
    } catch (requestError) {
      if (
        workspaceRequestGenerationRef.current !== generation ||
        controller.signal.aborted
      ) {
        return;
      }
      if (
        isApiRequestError(requestError) &&
        (requestError.status === 401 ||
          requestError.code === "authentication_required")
      ) {
        router.replace(
          `/auth?next=${encodeURIComponent(`/learn/${relationshipId}`)}`,
        );
        return;
      }
      setError(workspaceErrorMessage(requestError));
    } finally {
      if (workspaceRequestGenerationRef.current === generation) {
        setIsLoading(false);
        if (workspaceAbortControllerRef.current === controller) {
          workspaceAbortControllerRef.current = null;
        }
      }
    }
  }, [initialNodeId, relationshipId, router]);

  const refreshProgress = useCallback(async () => {
    const generation = progressRequestGenerationRef.current + 1;
    progressRequestGenerationRef.current = generation;
    progressAbortControllerRef.current?.abort();
    const controller = new AbortController();
    progressAbortControllerRef.current = controller;

    setIsRefreshingProgress(true);
    try {
      const response = await apiRequest<LearningProgressSummary>(
        `/api/learning-relationships/${encodeURIComponent(relationshipId)}/progress`,
        { signal: controller.signal },
      );
      if (
        progressRequestGenerationRef.current !== generation ||
        controller.signal.aborted
      ) {
        return;
      }
      setProgress(response);
    } catch (requestError) {
      if (
        progressRequestGenerationRef.current !== generation ||
        controller.signal.aborted
      ) {
        return;
      }
      if (
        isApiRequestError(requestError) &&
        (requestError.status === 401 ||
          requestError.code === "authentication_required")
      ) {
        router.replace(
          `/auth?next=${encodeURIComponent(`/learn/${relationshipId}`)}`,
        );
        return;
      }
      setError(workspaceErrorMessage(requestError));
    } finally {
      if (
        progressRequestGenerationRef.current === generation &&
        !controller.signal.aborted
      ) {
        setIsRefreshingProgress(false);
        if (progressAbortControllerRef.current === controller) {
          progressAbortControllerRef.current = null;
        }
      }
    }
  }, [relationshipId, router]);

  useEffect(() => {
    setMap(null);
    setProgress(null);
    setSelectedNodeId(null);
    void loadWorkspace();

    return () => {
      workspaceRequestGenerationRef.current += 1;
      workspaceAbortControllerRef.current?.abort();
      workspaceAbortControllerRef.current = null;
      progressRequestGenerationRef.current += 1;
      progressAbortControllerRef.current?.abort();
      progressAbortControllerRef.current = null;
    };
  }, [loadWorkspace]);

  // 拉取选中节点的问题，供在画布中周围展开
  useEffect(() => {
    if (!selectedNodeId) return;
    if (nodeQuestionsMap[selectedNodeId]) return;

    let cancelled = false;
    async function fetchQuestions() {
      try {
        const res = await apiRequest<{ questions: AssessmentQuestionRaw[] }>(
          `/api/learning-relationships/${encodeURIComponent(relationshipId)}/nodes/${encodeURIComponent(selectedNodeId!)}/assessment`,
        );
        if (!cancelled && res?.questions) {
          setNodeQuestionsMap((prev) => ({
            ...prev,
            [selectedNodeId!]: res.questions.map((q) => ({
              questionId: q.questionId,
              prompt: q.prompt,
              type: q.type,
            })),
          }));
        }
      } catch {
        // ignore
      }
    }
    void fetchQuestions();
    return () => {
      cancelled = true;
    };
  }, [selectedNodeId, relationshipId, nodeQuestionsMap]);

  const selectedNode = useMemo(
    () => map?.nodes.find((node) => node.nodeId === selectedNodeId) ?? null,
    [map, selectedNodeId],
  );
  const selectedProgress = useMemo(
    () =>
      progress?.nodes.find((node) => node.nodeId === selectedNodeId) ?? null,
    [progress, selectedNodeId],
  );
  const selectedViewpoints = useMemo(
    () =>
      map?.viewpoints.filter(
        (viewpoint) => viewpoint.nodeId === selectedNodeId,
      ) ?? [],
    [map, selectedNodeId],
  );

  const progressFacts = useMemo(() => {
    const totalNodeCount = map?.nodes.length ?? 0;
    const completedNodeIds = new Set(
      (progress?.nodes ?? [])
        .filter((node) => node.completed)
        .map((node) => node.nodeId),
    );
    const completedNodeCount =
      map?.nodes.filter((node) => completedNodeIds.has(node.nodeId)).length ??
      0;
    const selectedNodeIndex =
      map?.nodes.findIndex((node) => node.nodeId === selectedNodeId) ?? -1;
    const currentNodeNumber =
      selectedNodeIndex >= 0
        ? selectedNodeIndex + 1
        : totalNodeCount > 0
          ? Math.min(completedNodeCount + 1, totalNodeCount)
          : 0;
    const completionPercent =
      totalNodeCount > 0
        ? Math.round((completedNodeCount / totalNodeCount) * 100)
        : 0;

    return {
      completedNodeCount,
      totalNodeCount,
      currentNodeNumber,
      completionPercent,
    };
  }, [map, progress, selectedNodeId]);

  if (isLoading) {
    return (
      <div className={`app-frame ${styles.workspaceExperience}`}>
        <AppHeader email={email} eyebrow="学习工作区" />
        <main className={`workspace-main ${styles.workspaceMain}`}>
          <div className="workspace-loading" aria-busy="true">
            <Skeleton active paragraph={{ rows: 8 }} />
          </div>
        </main>
      </div>
    );
  }

  if (!map || map.nodes.length === 0) {
    return (
      <div className={`app-frame ${styles.workspaceExperience}`}>
        <AppHeader email={email} eyebrow="学习工作区" />
        <main className={`workspace-main ${styles.workspaceMain}`}>
          <Empty
            className="empty-panel page-empty"
            description={
              <div role="alert">
                <h1>地图内容暂时不可用</h1>
                <p>{error ?? "这张学习地图暂时不可用，或已不属于当前账户。"}</p>
                <div className="empty-panel-actions">
                  <Link href="/" className="button button-secondary">
                    返回首页
                  </Link>
                  <Button type="primary" onClick={() => void loadWorkspace()}>
                    重试
                  </Button>
                </div>
              </div>
            }
          />
        </main>
      </div>
    );
  }

  return (
    <div className={`app-frame ${styles.workspaceExperience}`}>
      <AppHeader email={email} eyebrow="学习工作区" />
      <main className={`workspace-main ${styles.workspaceMain}`}>
        {/* 顶部标题栏与进度 */}
        <div className={`workspace-heading ${styles.workspaceHeading}`}>
          <div className={styles.workspaceHeadingCopy}>
            <div className={styles.workspaceHeadingTrail}>
              <Link className="back-link" href="/learning">
                ← 我的学习
              </Link>
              <span className="section-kicker">学习地图</span>
            </div>
            <h1>{map.title}</h1>
            <p>{map.summary}</p>
            <div className={styles.workspaceProgress} aria-label="学习进度">
              <div className={styles.workspaceProgressFacts}>
                <span>
                  已完成{" "}
                  <strong>
                    {progressFacts.completedNodeCount}/
                    {progressFacts.totalNodeCount}
                  </strong>{" "}
                  个节点
                </span>
                <span>
                  当前节点{" "}
                  <strong>
                    {progressFacts.currentNodeNumber}/
                    {progressFacts.totalNodeCount}
                  </strong>
                </span>
              </div>
              <Progress
                percent={progressFacts.completionPercent}
                showInfo={false}
                strokeColor="var(--experience-blue)"
                trailColor="var(--experience-blue-soft)"
              />
            </div>
          </div>
          <div className="workspace-heading-actions">
            <Segmented
              value={viewMode}
              onChange={(val) => setViewMode(val as WorkspaceView)}
              options={[
                { label: "星图探索", value: "canvas" },
                { label: "卷轴时间轴", value: "timeline" },
              ]}
            />
            <Button
              type="text"
              size="small"
              className="button button-quiet button-small"
              onClick={() => void refreshProgress()}
              loading={isRefreshingProgress}
            >
              刷新进度
            </Button>
            <Link
              className="button button-secondary button-small"
              href={`/learn/${encodeURIComponent(relationshipId)}/report`}
            >
              查看私人报告
            </Link>
          </div>
        </div>

        {error ? (
          <Alert
            className="page-alert"
            role="alert"
            type="error"
            showIcon
            message={error}
          />
        ) : null}

        {/* 视图分发：时间轴视图 vs 默认双栏星图画布视图 */}
        {viewMode === "timeline" ? (
          <div
            style={{
              maxWidth: 780,
              margin: "32px auto",
              padding: "24px 32px 80px",
            }}
          >
            <div
              style={{
                position: "relative",
                paddingLeft: 36,
                borderLeft: "1px dashed var(--line)",
                display: "flex",
                flexDirection: "column",
                gap: 48,
              }}
            >
              {map.nodes.map((node, index) => {
                const nodeProgress = progress?.nodes.find(
                  (p) => p.nodeId === node.nodeId,
                );
                const isCompleted = nodeProgress?.completed === true;
                const isSelected = node.nodeId === selectedNodeId;

                return (
                  <div
                    key={node.nodeId}
                    style={{
                      position: "relative",
                      cursor: "pointer",
                    }}
                    onClick={() => {
                      setSelectedNodeId(node.nodeId);
                      setViewMode("canvas");
                    }}
                  >
                    <span
                      style={{
                        position: "absolute",
                        left: -43,
                        top: 4,
                        width: 14,
                        height: 14,
                        borderRadius: "50%",
                        background: isCompleted
                          ? "var(--jade)"
                          : isSelected
                            ? "var(--primary)"
                            : "var(--white)",
                        border: isCompleted
                          ? "none"
                          : isSelected
                            ? "2px solid var(--primary)"
                            : "2px solid var(--line)",
                      }}
                    />
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                        }}
                      >
                        <span
                          style={{
                            fontFamily: "var(--font-serif)",
                            fontSize: "1.2rem",
                            color: isSelected ? "var(--primary)" : "var(--ink)",
                            fontWeight: 600,
                          }}
                        >
                          {String(index + 1).padStart(2, "0")} · {node.title}
                        </span>
                        {isCompleted ? (
                          <Tag color="success">已掌握 ✓</Tag>
                        ) : (
                          <Tag>待验证</Tag>
                        )}
                      </div>
                      <p
                        style={{
                          margin: 0,
                          color: "var(--ink-soft)",
                          fontSize: "0.95rem",
                          lineHeight: 1.7,
                          fontFamily: "var(--font-body)",
                        }}
                      >
                        {node.learningObjective}
                      </p>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 16,
                          color: "var(--ink-muted)",
                          fontSize: "0.82rem",
                          marginTop: 4,
                        }}
                      >
                        <span>{node.sourceIds.length} 处真实讨论</span>
                        <span style={{ color: "var(--primary)" }}>
                          前往星图检验 ↗
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className={`workspace-grid ${styles.workspaceGrid}`}>
            {/* 左侧：无边框画布，周围展开问题 */}
            <LearningMapCanvas
              map={map}
              progress={progress}
              selectedNodeId={selectedNodeId}
              onSelectNode={(nodeId) => {
                setSelectedNodeId(nodeId);
                setAssessmentOpen(false);
              }}
              questionsForSelectedNode={
                selectedNodeId ? (nodeQuestionsMap[selectedNodeId] ?? []) : []
              }
              onOpenQuestion={() => {
                setAssessmentOpen(true);
              }}
            />

            {/* 右侧：答题检验面板或对应节点汇总栏 */}
            {assessmentOpen && selectedNode ? (
              <AssessmentPanel
                relationshipId={relationshipId}
                nodeId={selectedNode.nodeId}
                map={map}
                onBack={() => setAssessmentOpen(false)}
                onSubmitted={() => void refreshProgress()}
              />
            ) : (
              <aside
                className={`panel-card node-panel ${styles.nodePanel}`}
                aria-labelledby="node-panel-title"
              >
                {selectedNode ? (
                  <>
                    <div style={{ marginBottom: 16 }}>
                      <Segmented
                        value={activeTab}
                        onChange={(val) => setActiveTab(val as SidebarTab)}
                        options={[
                          { label: "节点内容", value: "content" },
                          { label: "文章概括", value: "digest" },
                          { label: "答题检验", value: "assessment" },
                        ]}
                      />
                    </div>

                    <div className="panel-heading">
                      <span className="section-kicker">当前节点</span>
                      <h2 id="node-panel-title">{selectedNode.title}</h2>
                      <p>{selectedNode.learningObjective}</p>
                    </div>

                    <div className={styles.nodeFacts} aria-label="节点事实">
                      <div>
                        <span>节点序号</span>
                        <strong>
                          {progressFacts.currentNodeNumber}/
                          {progressFacts.totalNodeCount}
                        </strong>
                      </div>
                      <div>
                        <span>最佳成绩</span>
                        <strong>
                          {selectedProgress
                            ? `${Math.round(selectedProgress.bestScore / 100)}%`
                            : "未作答"}
                        </strong>
                      </div>
                    </div>

                    <div className="node-status-line">
                      <Tag
                        color={selectedProgress?.completed ? "success" : "blue"}
                      >
                        {selectedProgress?.completed ? "已完成" : "尚未完成"}
                      </Tag>
                    </div>

                    {/* 依据选中的 Tab 呈现内容，默认 content 包含学习目标、观点与来源 */}
                    {activeTab === "content" && (
                      <>
                        {selectedViewpoints.length > 0 && (
                          <div style={{ marginTop: 14 }}>
                            {selectedViewpoints.map((vp) => (
                              <div
                                key={vp.viewpointId}
                                style={{
                                  color: "var(--ink)",
                                  fontSize: "0.92rem",
                                  lineHeight: 1.6,
                                  marginBottom: 6,
                                }}
                              >
                                {vp.statement}
                              </div>
                            ))}
                          </div>
                        )}

                        <section
                          className="panel-section"
                          aria-labelledby="node-sources-title"
                          aria-label="来源"
                        >
                          <div className="panel-section-heading">
                            <h3 id="node-sources-title">来源</h3>
                            <span>{selectedNode.sourceIds.length} 条</span>
                          </div>
                          {selectedNode.sourceIds.length > 0 ? (
                            <div className="source-list">
                              {selectedNode.sourceIds.map((sourceId) => {
                                const source = map.sources.find(
                                  (candidate) =>
                                    candidate.sourceId === sourceId,
                                );
                                if (!source) {
                                  return (
                                    <div
                                      className="source-missing"
                                      key={`${selectedNode.nodeId}:${sourceId}`}
                                    >
                                      来源条目暂时无法关联
                                    </div>
                                  );
                                }
                                return (
                                  <a
                                    key={sourceId}
                                    className="source-row"
                                    href={source.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    <strong>{source.title}</strong>
                                    {source.authorName && (
                                      <small>作者：{source.authorName}</small>
                                    )}
                                  </a>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="panel-muted">
                              该节点暂时没有关联的知乎讨论来源。
                            </p>
                          )}
                        </section>

                        <div
                          className="node-panel-actions"
                          style={{ marginTop: 20 }}
                        >
                          <Button
                            className="button button-primary button-block"
                            type="primary"
                            block
                            onClick={() => setAssessmentOpen(true)}
                          >
                            开始节点验证
                          </Button>
                        </div>
                      </>
                    )}

                    {activeTab === "digest" && (
                      <div style={{ marginTop: 16 }}>
                        <h3
                          style={{
                            fontFamily: "var(--font-serif)",
                            fontSize: "0.95rem",
                            color: "var(--primary)",
                            marginBottom: 8,
                          }}
                        >
                          观点梳理
                        </h3>
                        {selectedViewpoints.map((vp) => (
                          <div
                            key={vp.viewpointId}
                            style={{
                              padding: "10px 12px",
                              border: "1px dashed var(--line)",
                              borderRadius: 8,
                              marginBottom: 8,
                            }}
                          >
                            <Tag color="blue">{vp.kind}</Tag>
                            <div style={{ marginTop: 4, fontSize: "0.9rem" }}>
                              {vp.statement}
                            </div>
                            {vp.conditions && (
                              <div
                                style={{
                                  fontSize: "0.8rem",
                                  color: "var(--ink-muted)",
                                  marginTop: 4,
                                }}
                              >
                                条件：{vp.conditions}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {activeTab === "assessment" && (
                      <div style={{ marginTop: 20 }}>
                        <Button
                          type="primary"
                          block
                          onClick={() => setAssessmentOpen(true)}
                        >
                          开始节点验证
                        </Button>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="panel-muted">请选择一个节点查看详情。</div>
                )}
              </aside>
            )}
          </div>
        )}

        {/* 悬浮进度徽章 */}
        <div
          style={{
            position: "fixed",
            right: 24,
            bottom: 24,
            zIndex: 50,
            background: "rgba(251, 246, 236, 0.92)",
            border: "1px dashed var(--line)",
            backdropFilter: "blur(8px)",
            borderRadius: 16,
            padding: "10px 18px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            boxShadow: "0 4px 18px rgba(43, 36, 28, 0.08)",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: "0.78rem",
                color: "var(--ink-muted)",
              }}
            >
              总掌握度
            </span>
            <span
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: "1.2rem",
                color: "var(--jade)",
                fontWeight: 600,
              }}
            >
              {progressFacts.completionPercent}%
            </span>
          </div>

          <div style={{ width: 80 }}>
            <Progress
              percent={progressFacts.completionPercent}
              showInfo={false}
              size="small"
              strokeColor="var(--jade)"
            />
          </div>

          <span
            style={{
              fontSize: "0.82rem",
              color: "var(--ink-soft)",
              fontFamily: "var(--font-body)",
            }}
          >
            {progressFacts.completedNodeCount}/{progressFacts.totalNodeCount}{" "}
            节点
          </span>
        </div>
      </main>
    </div>
  );
}
