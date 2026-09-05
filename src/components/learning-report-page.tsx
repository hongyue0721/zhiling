"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Empty, List, Progress, Skeleton, Tag } from "antd";

import { AppHeader } from "@/components/app-header";
import { apiRequest, isApiRequestError } from "@/shared/ui/api-client";
import type { PrivateLearningReport } from "@/components/contracts";

type LearningReportPageProps = Readonly<{
  relationshipId: string;
  email: string;
}>;

const viewpointKindLabels: Record<string, string> = {
  consensus: "共识观点",
  disagreement: "关键分歧",
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
    return "完成至少一个节点的验证后，即可在此查看你的探索报告。";
  }
  if (error.status >= 500) {
    return "报告服务正忙，请稍候重试。";
  }
  return "报告暂时无法加载，请稍候重试。";
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
    <div className="app-frame" style={{ minHeight: "100vh" }}>
      <AppHeader email={email} eyebrow="私人报告" />
      <main
        style={{
          maxWidth: 860,
          margin: "0 auto",
          padding: "48px 24px 80px",
          position: "relative",
          zIndex: 1,
        }}
      >
        <div style={{ marginBottom: 36 }} data-reveal>
          <Link
            href={`/learn/${encodeURIComponent(relationshipId)}`}
            style={{
              color: "var(--ink-muted)",
              fontSize: "0.9rem",
              textDecoration: "none",
              fontFamily: "var(--font-serif)",
              display: "inline-block",
              marginBottom: 12,
            }}
          >
            ← 返回学习地图
          </Link>
          <span
            style={{
              display: "block",
              fontFamily: "var(--font-serif)",
              fontSize: "0.85rem",
              color: "var(--primary)",
              letterSpacing: "0.12em",
              marginBottom: 6,
            }}
          >
            探索进度总览
          </span>
          <h1
            style={{
              margin: 0,
              fontFamily: "var(--font-serif)",
              fontSize: "clamp(2rem, 3.5vw, 2.5rem)",
              color: "var(--ink)",
              fontWeight: 600,
            }}
          >
            {report?.map.title ?? "你的学习报告"}
          </h1>
        </div>

        {isLoading ? (
          <div style={{ padding: "40px 0" }} aria-busy="true">
            <Skeleton active paragraph={{ rows: 10 }} />
          </div>
        ) : report ? (
          <ReportContent report={report} />
        ) : (
          <Empty
            className="empty-panel page-empty"
            data-reveal
            description={
              <div
                role="alert"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
                  alignItems: "center",
                }}
              >
                <h2
                  style={{
                    fontFamily: "var(--font-serif)",
                    fontSize: "1.3rem",
                  }}
                >
                  报告暂时不可用
                </h2>
                <p style={{ margin: 0, color: "var(--ink-soft)" }}>
                  {error ??
                    "报告暂时不可用。完成至少一次节点验证后，服务端会生成你的私人报告。"}
                </p>
                <Link
                  href={`/learn/${encodeURIComponent(relationshipId)}`}
                  style={{
                    padding: "8px 24px",
                    background: "var(--primary)",
                    color: "var(--white)",
                    borderRadius: 20,
                    textDecoration: "none",
                    fontFamily: "var(--font-serif)",
                  }}
                >
                  返回地图答题 ↗
                </Link>
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
    <div style={{ display: "flex", flexDirection: "column", gap: 48 }}>
      {/* 顶部总览：无卡片大字纸面呈现 */}
      <section
        data-reveal
        style={
          {
            borderBottom: "1px dashed var(--line)",
            paddingBottom: 36,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            flexWrap: "wrap",
            gap: 24,
            "--reveal-delay": "0ms",
          } as CSSProperties
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span
            style={{
              fontSize: "0.88rem",
              color: "var(--primary)",
              fontFamily: "var(--font-serif)",
            }}
          >
            总体掌握程度
          </span>
          <h2
            id="report-overview-title"
            aria-label="按服务端记录的节点完成情况"
            style={{
              margin: 0,
              fontFamily: "var(--font-serif)",
              fontSize: "1.5rem",
              color: "var(--ink)",
              fontWeight: 600,
            }}
          >
            按服务端记录的节点完成情况
          </h2>
          <div style={{ display: "flex", gap: 24, marginTop: 8 }}>
            <div>
              <strong
                style={{
                  fontSize: "1.3rem",
                  fontFamily: "var(--font-serif)",
                  color: "var(--jade)",
                }}
              >
                {report.completion.completedNodeCount}
              </strong>
              <span
                style={{
                  marginLeft: 6,
                  fontSize: "0.85rem",
                  color: "var(--ink-muted)",
                }}
              >
                已掌握
              </span>
            </div>
            <div>
              <strong
                style={{
                  fontSize: "1.3rem",
                  fontFamily: "var(--font-serif)",
                  color: "var(--cinnabar)",
                }}
              >
                {report.weakNodes.length}
              </strong>
              <span
                style={{
                  marginLeft: 6,
                  fontSize: "0.85rem",
                  color: "var(--ink-muted)",
                }}
              >
                待巩固
              </span>
            </div>
            <div>
              <strong
                style={{
                  fontSize: "1.3rem",
                  fontFamily: "var(--font-serif)",
                  color: "var(--ink)",
                }}
              >
                {report.encounteredViewpoints.length}
              </strong>
              <span
                style={{
                  marginLeft: 6,
                  fontSize: "0.85rem",
                  color: "var(--ink-muted)",
                }}
              >
                接触观点
              </span>
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 8,
          }}
        >
          <strong
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: "3.4rem",
              fontWeight: 400,
              color: "var(--jade)",
              lineHeight: 1,
            }}
          >
            {completionPercent.toFixed(0)}%
          </strong>
          <div style={{ width: 140 }}>
            <Progress
              percent={Math.max(0, Math.min(100, completionPercent))}
              showInfo={false}
              size="small"
              strokeColor="var(--jade)"
            />
          </div>
        </div>
      </section>

      {/* 薄弱节点 */}
      {report.weakNodes.length > 0 && (
        <section
          data-reveal
          style={
            {
              borderBottom: "1px dashed var(--line)",
              paddingBottom: 36,
              "--reveal-delay": "60ms",
            } as CSSProperties
          }
        >
          <h3
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: "1.15rem",
              color: "var(--primary)",
              marginBottom: 16,
            }}
          >
            建议再次巩固的节点
          </h3>
          <List
            dataSource={report.weakNodes.slice()}
            renderItem={(node) => (
              <ListItem
                style={{
                  padding: "12px 0",
                  borderBottom: "1px dashed var(--line)",
                }}
              >
                <Link
                  href={`/learn/${encodeURIComponent(report.learningRelationshipId)}?node=${encodeURIComponent(node.nodeId)}`}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    textDecoration: "none",
                  }}
                >
                  <div>
                    <span
                      style={{
                        fontFamily: "var(--font-serif)",
                        fontSize: "1.05rem",
                        color: "var(--ink)",
                        fontWeight: 600,
                      }}
                    >
                      {node.title}
                    </span>
                    <span
                      style={{
                        marginLeft: 12,
                        fontSize: "0.82rem",
                        color: "var(--ink-muted)",
                      }}
                    >
                      得分 {Math.round(node.bestScore / 100)}%
                    </span>
                  </div>
                  <span
                    style={{
                      color: "var(--primary)",
                      fontFamily: "var(--font-serif)",
                    }}
                  >
                    去验证 ↗
                  </span>
                </Link>
              </ListItem>
            )}
          />
        </section>
      )}

      {/* 下一步建议 */}
      {report.nextSteps.length > 0 && (
        <section
          data-reveal
          style={
            {
              borderBottom: "1px dashed var(--line)",
              paddingBottom: 36,
              "--reveal-delay": "120ms",
            } as CSSProperties
          }
        >
          <h3
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: "1.15rem",
              color: "var(--primary)",
              marginBottom: 16,
            }}
          >
            接下来的探索步调
          </h3>
          <List
            dataSource={report.nextSteps.slice()}
            renderItem={(node) => (
              <ListItem
                style={{
                  padding: "12px 0",
                  borderBottom: "1px dashed var(--line)",
                }}
              >
                <Link
                  href={`/learn/${encodeURIComponent(report.learningRelationshipId)}?node=${encodeURIComponent(node.nodeId)}`}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    textDecoration: "none",
                  }}
                >
                  <div>
                    <span
                      style={{
                        fontFamily: "var(--font-serif)",
                        fontSize: "1.05rem",
                        color: "var(--ink)",
                        fontWeight: 600,
                      }}
                    >
                      {node.title}
                    </span>
                    <p
                      style={{
                        margin: "4px 0 0",
                        color: "var(--ink-soft)",
                        fontSize: "0.88rem",
                      }}
                    >
                      {node.learningObjective}
                    </p>
                  </div>
                  <span
                    style={{
                      color: "var(--primary)",
                      fontFamily: "var(--font-serif)",
                    }}
                  >
                    开始 ↗
                  </span>
                </Link>
              </ListItem>
            )}
          />
        </section>
      )}

      {/* 接触过的真实观点 */}
      {report.encounteredViewpoints.length > 0 && (
        <section
          data-reveal
          style={
            {
              borderBottom: "1px dashed var(--line)",
              paddingBottom: 36,
              "--reveal-delay": "180ms",
            } as CSSProperties
          }
        >
          <h3
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: "1.15rem",
              color: "var(--primary)",
              marginBottom: 16,
            }}
          >
            已吸纳的讨论观点
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {report.encounteredViewpoints.map((vp) => (
              <div
                key={vp.viewpointId}
                style={{
                  padding: "12px 0",
                  borderBottom: "1px dashed var(--line)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 4,
                  }}
                >
                  <Tag color="blue">
                    {viewpointKindLabels[vp.kind] ?? vp.kind}
                  </Tag>
                </div>
                <div
                  style={{
                    color: "var(--ink)",
                    lineHeight: 1.7,
                    fontSize: "0.95rem",
                  }}
                >
                  {vp.statement}
                </div>
                {vp.conditions && (
                  <div
                    style={{
                      color: "var(--ink-muted)",
                      fontSize: "0.82rem",
                      marginTop: 4,
                    }}
                  >
                    适用情境：{vp.conditions}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 参考真实来源 */}
      {report.sources.length > 0 && (
        <section
          data-reveal
          style={
            {
              paddingBottom: 24,
              "--reveal-delay": "240ms",
            } as CSSProperties
          }
        >
          <h3
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: "1.15rem",
              color: "var(--primary)",
              marginBottom: 16,
            }}
          >
            参考的真实讨论来源
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {report.sources.map((src) => (
              <a
                key={src.sourceId}
                href={src.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  padding: "12px 0",
                  borderBottom: "1px dashed var(--line)",
                  textDecoration: "none",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <span
                  style={{
                    color: "var(--primary)",
                    fontFamily: "var(--font-serif)",
                    fontSize: "0.98rem",
                    fontWeight: 600,
                  }}
                >
                  {src.title} ↗
                </span>
                {src.authorName && (
                  <span
                    style={{ color: "var(--ink-soft)", fontSize: "0.85rem" }}
                  >
                    作者：{src.authorName}
                  </span>
                )}
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
