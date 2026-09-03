"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Empty, List, Progress, Skeleton, Tag } from "antd";

import { AppHeader } from "@/components/app-header";
import { apiRequest, isApiRequestError } from "@/shared/ui/api-client";
import type { PrivateLearningReport } from "@/components/contracts";

type LearningReportPageProps = Readonly<{
  relationshipId: string;
  email: string;
}>;

const viewpointKindLabels: Record<string, string> = {
  consensus: "共识",
  disagreement: "分歧",
  practical_experience: "实践经验",
  supplementary: "补充材料",
};

const { Item: ListItem } = List;

function reportErrorMessage(error: unknown): string {
  if (!isApiRequestError(error)) {
    return "网络连接失败，请稍后重试。";
  }
  if (error.status === 401 || error.code === "authentication_required") {
    return "登录状态已失效，请重新登录。";
  }
  if (error.code === "resource_not_found" || error.status === 404) {
    return "报告暂时不可用。完成至少一次节点验证后，服务端会生成你的私人报告。";
  }
  if (error.status >= 500) {
    return "报告服务暂时不可用，请稍后重试。";
  }
  return "报告暂时无法加载，请稍后重试。";
}

export function LearningReportPage({
  relationshipId,
  email,
}: LearningReportPageProps) {
  const router = useRouter();
  const [report, setReport] = useState<PrivateLearningReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reportRequestGenerationRef = useRef(0);
  const reportAbortControllerRef = useRef<AbortController | null>(null);

  const loadReport = useCallback(async () => {
    const generation = reportRequestGenerationRef.current + 1;
    reportRequestGenerationRef.current = generation;
    reportAbortControllerRef.current?.abort();
    const controller = new AbortController();
    reportAbortControllerRef.current = controller;

    setIsLoading(true);
    setError(null);
    try {
      const response = await apiRequest<PrivateLearningReport>(
        `/api/learning-relationships/${encodeURIComponent(relationshipId)}/report`,
        { signal: controller.signal },
      );
      if (
        reportRequestGenerationRef.current !== generation ||
        controller.signal.aborted
      ) {
        return;
      }
      setReport(response);
    } catch (requestError) {
      if (
        reportRequestGenerationRef.current !== generation ||
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
          `/auth?next=${encodeURIComponent(`/learn/${relationshipId}/report`)}`,
        );
        return;
      }
      setError(reportErrorMessage(requestError));
    } finally {
      if (
        reportRequestGenerationRef.current === generation &&
        !controller.signal.aborted
      ) {
        setIsLoading(false);
        if (reportAbortControllerRef.current === controller) {
          reportAbortControllerRef.current = null;
        }
      }
    }
  }, [relationshipId, router]);

  useEffect(() => {
    setReport(null);
    void loadReport();

    return () => {
      reportRequestGenerationRef.current += 1;
      reportAbortControllerRef.current?.abort();
      reportAbortControllerRef.current = null;
    };
  }, [loadReport]);

  return (
    <div className="app-frame">
      <AppHeader email={email} eyebrow="私人报告" />
      <main className="report-main">
        <div className="report-heading">
          <Link
            className="back-link"
            href={`/learn/${encodeURIComponent(relationshipId)}`}
          >
            ← 返回学习地图
          </Link>
          <span className="section-kicker">私人报告</span>
          <h1>{report?.map.title ?? "你的学习报告"}</h1>
          {report ? (
            <p aria-label="地图版本">版本：{report.map.versionId}</p>
          ) : null}
          <p>报告仅展示当前学习关系的服务端事实，不含答案与尝试明细。</p>
        </div>

        {isLoading ? (
          <div className="report-loading" aria-busy="true">
            <Skeleton active paragraph={{ rows: 10 }} />
          </div>
        ) : report ? (
          <ReportContent report={report} />
        ) : (
          <Empty
            className="empty-panel page-empty"
            description={
              <div role="alert">
                <h2>报告还没有准备好</h2>
                <p>{error ?? "完成至少一次节点验证后再回来查看。"}</p>
                <div className="empty-panel-actions">
                  <Link
                    className="button button-primary"
                    href={`/learn/${encodeURIComponent(relationshipId)}`}
                  >
                    返回地图答题
                  </Link>
                  <Button type="default" onClick={() => void loadReport()}>
                    重试
                  </Button>
                </div>
              </div>
            }
          />
        )}
      </main>
    </div>
  );
}

type ReportContentProps = Readonly<{
  report: PrivateLearningReport;
}>;

function ReportContent({ report }: ReportContentProps) {
  const completionPercent = report.completion.completionBasisPoints / 100;
  return (
    <div className="report-content">
      <section
        className="report-overview"
        aria-labelledby="report-overview-title"
      >
        <div className="report-overview-copy">
          <span className="section-kicker">完成度</span>
          <h2 id="report-overview-title">按服务端记录的节点完成情况</h2>
          <p>
            已完成 {report.completion.completedNodeCount} /{" "}
            {report.completion.totalNodeCount} 个节点
          </p>
        </div>
        <div
          className="completion-meter"
          aria-label={`完成度 ${completionPercent}%`}
        >
          <strong>{completionPercent.toFixed(0)}%</strong>
          <Progress
            percent={Math.max(0, Math.min(100, completionPercent))}
            showInfo={false}
            status={completionPercent >= 100 ? "success" : "active"}
          />
        </div>
      </section>

      <div className="report-section-grid">
        <ReportSection
          eyebrow="薄弱节点"
          title="值得再走一遍"
          count={report.weakNodes.length}
        >
          {report.weakNodes.length > 0 ? (
            <List
              className="report-item-list"
              dataSource={report.weakNodes.slice()}
              renderItem={(node) => (
                <ListItem key={node.nodeId}>
                  <Link
                    className="report-item report-item-link"
                    href={`/learn/${encodeURIComponent(report.learningRelationshipId)}?node=${encodeURIComponent(node.nodeId)}`}
                  >
                    <span>
                      <strong>{node.title}</strong>
                      <small>
                        最佳成绩 {Math.round(node.bestScore / 100)}%
                      </small>
                    </span>
                    <span aria-hidden="true">→</span>
                  </Link>
                </ListItem>
              )}
            />
          ) : (
            <p className="panel-muted">暂时没有已作答但未完成的节点。</p>
          )}
        </ReportSection>

        <ReportSection
          eyebrow="下一步"
          title="继续前进"
          count={report.nextSteps.length}
        >
          {report.nextSteps.length > 0 ? (
            <List
              className="report-item-list"
              dataSource={report.nextSteps.slice()}
              renderItem={(step) => (
                <ListItem key={`${step.nodeId}:${step.reason}`}>
                  <Link
                    className="report-item report-item-link"
                    href={`/learn/${encodeURIComponent(report.learningRelationshipId)}?node=${encodeURIComponent(step.nodeId)}`}
                  >
                    <span>
                      <strong>{step.title}</strong>
                      <small>
                        {step.reason === "improve_score"
                          ? "再次验证，巩固理解"
                          : step.learningObjective}
                      </small>
                    </span>
                    <span aria-hidden="true">→</span>
                  </Link>
                </ListItem>
              )}
            />
          ) : (
            <p className="panel-muted">当前没有新的服务端建议。</p>
          )}
        </ReportSection>
      </div>

      <section
        className="report-section report-viewpoints"
        aria-labelledby="report-viewpoints-title"
      >
        <div className="report-section-heading">
          <div>
            <span className="section-kicker">已接触观点</span>
            <h2 id="report-viewpoints-title">不把复杂讨论压成一个答案</h2>
          </div>
          <span>{report.encounteredViewpoints.length} 条观点</span>
        </div>
        {report.encounteredViewpoints.length > 0 ? (
          <div className="viewpoint-report-grid">
            {report.encounteredViewpoints.map((viewpoint) => (
              <article
                className="viewpoint-card viewpoint-report-card"
                key={`${viewpoint.nodeId}:${viewpoint.viewpointId}`}
              >
                <div className="viewpoint-meta">
                  <Tag color="blue">
                    {viewpointKindLabels[viewpoint.kind] ?? viewpoint.kind}
                  </Tag>
                  <span>{viewpoint.sourceIds.length} 个来源</span>
                </div>
                <p>{viewpoint.statement}</p>
                {viewpoint.conditions ? (
                  <p className="viewpoint-conditions">
                    <strong>适用条件：</strong>
                    {viewpoint.conditions}
                  </p>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <p className="panel-muted">
            完成节点验证后，这里会汇总你实际接触过的观点。
          </p>
        )}
      </section>

      <section
        className="report-section report-sources"
        aria-labelledby="report-sources-title"
      >
        <div className="report-section-heading">
          <div>
            <span className="section-kicker">引用来源</span>
            <h2 id="report-sources-title">回到原文继续阅读</h2>
          </div>
          <span>{report.sources.length} 条来源</span>
        </div>
        {report.sources.length > 0 ? (
          <div className="report-source-grid">
            {report.sources.map((source) => (
              <a
                className="report-source-card"
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                key={source.sourceId}
              >
                <strong>{source.title}</strong>
                <span>{source.authorName}</span>
                <span className="report-source-link">打开知乎原文 ↗</span>
              </a>
            ))}
          </div>
        ) : (
          <p className="panel-muted">报告暂时没有可展示的来源。</p>
        )}
      </section>
    </div>
  );
}

type ReportSectionProps = Readonly<{
  eyebrow: string;
  title: string;
  count: number;
  children: ReactNode;
}>;

function ReportSection({
  eyebrow,
  title,
  count,
  children,
}: ReportSectionProps) {
  return (
    <section className="report-section" aria-label={title}>
      <div className="report-section-heading">
        <div>
          <span className="section-kicker">{eyebrow}</span>
          <h2>{title}</h2>
        </div>
        <span>{count}</span>
      </div>
      {children}
    </section>
  );
}
