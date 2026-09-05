"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type CSSProperties } from "react";
import { Alert, Button, Empty, List, Pagination, Skeleton, Tag } from "antd";

import { AppHeader } from "@/components/app-header";
import type {
  LearningRelationshipList,
  LearningRelationshipSummary,
} from "@/components/contracts";
import { apiRequest, isApiRequestError } from "@/shared/ui/api-client";

const PAGE_SIZE = 5;
const { Item: ListItem } = List;

type MyLearningPageProps = Readonly<{
  email: string;
  initialPage: number;
}>;

function learningErrorMessage(error: unknown): string {
  if (!isApiRequestError(error)) return "网络连接失败，请稍后重试。";
  if (error.status === 401 || error.code === "authentication_required") {
    return "登录状态已失效，请重新登录。";
  }
  if (error.status >= 500) {
    return "学径记录暂时无法加载，请稍候重试。";
  }
  return "学习记录暂时不可用，请稍候重试。";
}

export function MyLearningPage({ email, initialPage }: MyLearningPageProps) {
  const router = useRouter();
  const [relationships, setRelationships] = useState<
    readonly LearningRelationshipSummary[]
  >([]);
  const [page, setPage] = useState(initialPage);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => setPage(initialPage), [initialPage]);

  useEffect(() => {
    let cancelled = false;

    async function loadRelationships() {
      setIsLoading(true);
      setError(null);
      try {
        const response = await apiRequest<LearningRelationshipList>(
          "/api/learning-relationships",
        );
        if (!cancelled) setRelationships(response.items);
      } catch (requestError) {
        if (cancelled) return;
        if (
          isApiRequestError(requestError) &&
          (requestError.status === 401 ||
            requestError.code === "authentication_required")
        ) {
          router.replace("/auth?next=/learning");
          return;
        }
        setError(learningErrorMessage(requestError));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadRelationships();
    return () => {
      cancelled = true;
    };
  }, [reloadToken, router]);

  useEffect(() => {
    if (isLoading || error) return;
    const lastPage = Math.max(1, Math.ceil(relationships.length / PAGE_SIZE));
    const safePage = Math.min(Math.max(page, 1), lastPage);
    if (safePage !== page) {
      setPage(safePage);
      router.replace(`/learning?page=${safePage}`);
    }
  }, [error, isLoading, page, relationships.length, router]);

  function changePage(nextPage: number) {
    const lastPage = Math.max(1, Math.ceil(relationships.length / PAGE_SIZE));
    const safePage = Math.min(Math.max(nextPage, 1), lastPage);
    setPage(safePage);
    router.push(`/learning?page=${safePage}`);
  }

  const lastPage = Math.max(1, Math.ceil(relationships.length / PAGE_SIZE));
  const currentPage = Math.min(Math.max(page, 1), lastPage);
  const visibleRelationships = relationships.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  return (
    <div className="app-frame" style={{ minHeight: "100vh" }}>
      <AppHeader email={email} eyebrow="我的学径" />
      <main
        style={{
          maxWidth: 820,
          margin: "0 auto",
          padding: "48px 24px 80px",
          position: "relative",
          zIndex: 1,
        }}
      >
        <header style={{ marginBottom: 40 }} data-reveal>
          <span
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: "0.88rem",
              color: "var(--primary)",
              letterSpacing: "0.12em",
              display: "block",
              marginBottom: 8,
            }}
          >
            探索印记
          </span>
          <h1
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: "clamp(2rem, 3.5vw, 2.6rem)",
              fontWeight: 400,
              color: "var(--ink)",
              letterSpacing: "0.04em",
              margin: 0,
            }}
          >
            正在前行的学习路径
          </h1>
          <p
            style={{
              color: "var(--ink-soft)",
              fontSize: "1.02rem",
              marginTop: 10,
              fontFamily: "var(--font-body)",
            }}
          >
            为你保存的学习地图与进度，随时继续前行。
          </p>
        </header>

        {error ? (
          <Alert
            style={{ marginBottom: 24 }}
            data-reveal
            type="error"
            showIcon
            message={error}
            action={
              <Button
                size="small"
                onClick={() => setReloadToken((current) => current + 1)}
              >
                重试
              </Button>
            }
          />
        ) : null}

        {isLoading ? (
          <div style={{ padding: "40px 0" }} aria-busy="true">
            <Skeleton active paragraph={{ rows: 8 }} />
          </div>
        ) : relationships.length > 0 ? (
          <section aria-label="我的学习列表">
            <List
              dataSource={visibleRelationships}
              renderItem={(relationship, index) => (
                <ListItem
                  key={relationship.learningRelationshipId}
                  style={{
                    borderBottom: "1px dashed var(--line)",
                    padding: "32px 0",
                  }}
                >
                  <article
                    data-reveal
                    style={
                      {
                        width: "100%",
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                        "--reveal-delay": `${index * 60}ms`,
                      } as CSSProperties
                    }
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        flexWrap: "wrap",
                        gap: 8,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                        }}
                      >
                        <span
                          style={{
                            fontFamily: "var(--font-serif)",
                            fontSize: "1.1rem",
                            color: "var(--primary)",
                            fontWeight: 600,
                          }}
                        >
                          {String(
                            (currentPage - 1) * PAGE_SIZE + index + 1,
                          ).padStart(2, "0")}
                        </span>
                        <Tag
                          color="success"
                          style={{
                            borderRadius: 12,
                          }}
                        >
                          进行中
                        </Tag>
                      </div>

                      <Link
                        href={`/learn/${encodeURIComponent(relationship.learningRelationshipId)}`}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "6px 18px",
                          borderRadius: 20,
                          background: "var(--primary)",
                          color: "var(--white)",
                          fontFamily: "var(--font-serif)",
                          fontSize: "0.9rem",
                          textDecoration: "none",
                          boxShadow: "0 2px 10px rgba(138, 68, 35, 0.22)",
                          transition: "transform 0.2s ease",
                        }}
                      >
                        继续研习 ↗
                      </Link>
                    </div>

                    <Link
                      href={`/learn/${encodeURIComponent(relationship.learningRelationshipId)}`}
                      style={{ textDecoration: "none" }}
                    >
                      <h2
                        style={{
                          margin: "4px 0 0",
                          fontFamily: "var(--font-serif)",
                          fontSize: "1.35rem",
                          color: "var(--ink)",
                          fontWeight: 600,
                          lineHeight: 1.4,
                        }}
                      >
                        {relationship.title}
                      </h2>
                    </Link>

                    <p
                      style={{
                        margin: 0,
                        color: "var(--ink-soft)",
                        lineHeight: 1.8,
                        fontSize: "0.95rem",
                        fontFamily: "var(--font-body)",
                      }}
                    >
                      {relationship.summary}
                    </p>
                  </article>
                </ListItem>
              )}
            />

            <div
              style={{
                display: "flex",
                justifyContent: "center",
                marginTop: 40,
              }}
              data-reveal
            >
              <Pagination
                current={currentPage}
                pageSize={PAGE_SIZE}
                total={relationships.length}
                hideOnSinglePage
                showLessItems
                showSizeChanger={false}
                onChange={changePage}
                aria-label="我的学习分页"
              />
            </div>
          </section>
        ) : (
          <Empty
            data-reveal
            description={
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
                  alignItems: "center",
                }}
              >
                <p style={{ margin: 0, fontFamily: "var(--font-body)" }}>
                  还没有加入任何学习地图。
                </p>
                <Link
                  href="/featured"
                  style={{
                    padding: "8px 24px",
                    background: "var(--primary)",
                    color: "var(--white)",
                    borderRadius: 20,
                    textDecoration: "none",
                    fontFamily: "var(--font-serif)",
                    fontSize: "0.95rem",
                  }}
                >
                  去挑选精选航标 ↗
                </Link>
              </div>
            }
          />
        )}
      </main>
    </div>
  );
}
