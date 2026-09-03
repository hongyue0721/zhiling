"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppHeader } from "@/components/app-header";
import { AssessmentPanel } from "@/components/assessment-panel";
import { LearningMapCanvas } from "@/components/learning-map-canvas";
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

const viewpointKindLabels: Record<string, string> = {
  consensus: "共识",
  disagreement: "分歧",
  practical_experience: "实践经验",
  supplementary: "补充材料",
};

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
      if (
        workspaceRequestGenerationRef.current === generation &&
        !controller.signal.aborted
      ) {
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

  if (isLoading) {
    return (
      <div className="app-frame">
        <AppHeader email={email} eyebrow="学习工作区" />
        <main className="workspace-main">
          <div className="workspace-loading" aria-busy="true">
            <div className="loading-card loading-card-large" />
            <div className="loading-lines">
              <span />
              <span />
              <span />
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (!map || map.nodes.length === 0) {
    return (
      <div className="app-frame">
        <AppHeader email={email} eyebrow="学习工作区" />
        <main className="workspace-main">
          <div className="empty-panel page-empty" role="alert">
            <span className="empty-panel-mark" aria-hidden="true">
              !
            </span>
            <h1>地图内容暂时不可用</h1>
            <p>{error ?? "服务没有返回可展示的学习节点。"}</p>
            <div className="empty-panel-actions">
              <Link href="/" className="button button-secondary">
                返回首页
              </Link>
              <button
                type="button"
                className="button button-primary"
                onClick={() => void loadWorkspace()}
              >
                重试
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app-frame">
      <AppHeader email={email} eyebrow="学习工作区" />
      <main className="workspace-main">
        <div className="workspace-heading">
          <div>
            <Link className="back-link" href="/">
              ← 我的学习
            </Link>
            <span className="section-kicker">学习地图</span>
            <h1>{map.title}</h1>
            <p>{map.summary}</p>
          </div>
          <div className="workspace-heading-actions">
            <button
              type="button"
              className="button button-quiet button-small"
              onClick={() => void refreshProgress()}
              disabled={isRefreshingProgress}
            >
              {isRefreshingProgress ? "刷新中…" : "刷新进度"}
            </button>
            <Link
              className="button button-secondary button-small"
              href={`/learn/${encodeURIComponent(relationshipId)}/report`}
            >
              查看私人报告
            </Link>
          </div>
        </div>

        {error ? (
          <div className="page-alert" role="alert">
            {error}
          </div>
        ) : null}

        <div className="workspace-grid">
          <LearningMapCanvas
            map={map}
            progress={progress}
            selectedNodeId={selectedNodeId}
            onSelectNode={(nodeId) => {
              setSelectedNodeId(nodeId);
              setAssessmentOpen(false);
            }}
          />

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
              className="panel-card node-panel"
              aria-labelledby="node-panel-title"
            >
              {selectedNode ? (
                <>
                  <div className="panel-heading">
                    <span className="section-kicker">当前节点</span>
                    <h2 id="node-panel-title">{selectedNode.title}</h2>
                    <p>{selectedNode.learningObjective}</p>
                  </div>
                  <div className="node-status-line">
                    <span
                      className={`status-dot ${selectedProgress?.completed ? "complete" : "pending"}`}
                      aria-hidden="true"
                    />
                    <strong>
                      {selectedProgress?.completed ? "已完成" : "尚未完成"}
                    </strong>
                    {selectedProgress?.completed ? (
                      <span>服务端已记录完成状态</span>
                    ) : (
                      <span>完成题目后更新状态</span>
                    )}
                  </div>

                  <section
                    className="panel-section"
                    aria-labelledby="node-sources-title"
                  >
                    <div className="panel-section-heading">
                      <h3 id="node-sources-title">来源</h3>
                      <span>{selectedNode.sourceIds.length} 条</span>
                    </div>
                    {selectedNode.sourceIds.length > 0 ? (
                      <div className="source-list">
                        {selectedNode.sourceIds.map((sourceId) => {
                          const source = map.sources.find(
                            (candidate) => candidate.sourceId === sourceId,
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
                              className="source-row"
                              href={source.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              key={`${selectedNode.nodeId}:${source.sourceId}`}
                            >
                              <span>
                                <strong>{source.title}</strong>
                                <small>{source.authorName}</small>
                                {source.excerpt ? (
                                  <small className="source-excerpt">
                                    {source.excerpt}
                                  </small>
                                ) : null}
                              </span>
                              <span aria-hidden="true">↗</span>
                            </a>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="panel-muted">
                        该节点没有可展示的来源条目。
                      </p>
                    )}
                  </section>

                  <section
                    className="panel-section"
                    aria-labelledby="viewpoints-title"
                  >
                    <div className="panel-section-heading">
                      <h3 id="viewpoints-title">观点</h3>
                      <span>{selectedViewpoints.length} 条</span>
                    </div>
                    {selectedViewpoints.length > 0 ? (
                      <div className="viewpoint-list">
                        {selectedViewpoints.map((viewpoint) => (
                          <article
                            className="viewpoint-card"
                            key={`${viewpoint.nodeId}:${viewpoint.viewpointId}`}
                          >
                            <div className="viewpoint-meta">
                              <span className="kind-badge">
                                {viewpointKindLabels[viewpoint.kind] ??
                                  viewpoint.kind}
                              </span>
                              <span>{viewpoint.sourceIds.length} 个来源</span>
                            </div>
                            <p>{viewpoint.statement}</p>
                            {viewpoint.conditions ? (
                              <p className="viewpoint-conditions">
                                <strong>适用条件：</strong>
                                {viewpoint.conditions}
                              </p>
                            ) : null}
                            <div
                              className="viewpoint-sources"
                              aria-label="观点依据来源"
                            >
                              {viewpoint.sourceIds.map((sourceId) => {
                                const source = map.sources.find(
                                  (candidate) =>
                                    candidate.sourceId === sourceId,
                                );
                                return source ? (
                                  <a
                                    href={source.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    key={`${viewpoint.nodeId}:${viewpoint.viewpointId}:${sourceId}`}
                                  >
                                    {source.title}
                                  </a>
                                ) : (
                                  <span
                                    className="source-missing"
                                    key={`${viewpoint.nodeId}:${viewpoint.viewpointId}:${sourceId}`}
                                  >
                                    来源条目暂时无法关联
                                  </span>
                                );
                              })}
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p className="panel-muted">
                        选择其他节点查看已关联观点。
                      </p>
                    )}
                  </section>

                  <div className="panel-action">
                    <button
                      type="button"
                      className="button button-primary button-block"
                      onClick={() => setAssessmentOpen(true)}
                    >
                      {selectedProgress?.completed
                        ? "再次验证"
                        : "开始节点验证"}
                    </button>
                    <p className="panel-action-help">
                      每次提交都会由服务端评分，并保存最佳成绩。
                    </p>
                  </div>
                </>
              ) : (
                <div className="panel-muted">请选择一个节点查看详情。</div>
              )}
            </aside>
          )}
        </div>
      </main>
    </div>
  );
}
