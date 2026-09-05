"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type CSSProperties } from "react";
import { Alert, Button, Empty, List, Pagination, Skeleton, Tag } from "antd";

import { AppHeader } from "@/components/app-header";
import type {
  FeaturedLearningMapSummary,
  LearningRelationshipCreation,
  LearningRelationshipList,
  LearningRelationshipSummary,
} from "@/components/contracts";
import { apiRequest, isApiRequestError } from "@/shared/ui/api-client";

const PAGE_SIZE = 4;
const { Item: ListItem } = List;

type FeaturedMapsPageProps = Readonly<{
  email: string;
  initialPage: number;
}>;

function featuredErrorMessage(error: unknown): string {
  if (!isApiRequestError(error)) return "网络连接失败，请稍后重试。";
  if (error.status === 401 || error.code === "authentication_required") {
    return "登录状态已失效，请重新登录。";
  }
  if (error.status >= 500) {
    return "精选航标暂时无法加载，请稍候重试。";
  }
  return "精选航标暂时不可用，请稍候重试。";
}

export function FeaturedMapsPage({
  email,
  initialPage,
}: FeaturedMapsPageProps) {
  const router = useRouter();
  const [featured, setFeatured] = useState<
    readonly FeaturedLearningMapSummary[]
  >([]);
  const [relationships, setRelationships] = useState<
    readonly LearningRelationshipSummary[]
  >([]);
  const [page, setPage] = useState(initialPage);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [joiningMapId, setJoiningMapId] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => setPage(initialPage), [initialPage]);

  useEffect(() => {
    let cancelled = false;

    async function loadFeatured() {
      setIsLoading(true);
      setError(null);
      try {
        const [featuredResponse, relationshipResponse] = await Promise.all([
          apiRequest<{ items: readonly FeaturedLearningMapSummary[] }>(
            "/api/featured-learning-maps",
          ),
          apiRequest<LearningRelationshipList>("/api/learning-relationships"),
        ]);
        if (!cancelled) {
          setFeatured(featuredResponse.items);
          setRelationships(relationshipResponse.items);
        }
      } catch (requestError) {
        if (cancelled) return;
        if (
          isApiRequestError(requestError) &&
          (requestError.status === 401 ||
            requestError.code === "authentication_required")
        ) {
          router.replace("/auth?next=/featured");
          return;
        }
        setError(featuredErrorMessage(requestError));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadFeatured();
    return () => {
      cancelled = true;
    };
  }, [reloadToken, router]);

  useEffect(() => {
    if (isLoading || error) return;
    const lastPage = Math.max(1, Math.ceil(featured.length / PAGE_SIZE));
    const safePage = Math.min(Math.max(page, 1), lastPage);
    if (safePage !== page) {
      setPage(safePage);
      router.replace(`/featured?page=${safePage}`);
    }
  }, [error, featured.length, isLoading, page, router]);

  async function joinFeaturedMap(map: FeaturedLearningMapSummary) {
    setJoiningMapId(map.mapId);
    setError(null);
    try {
      const relationship = await apiRequest<LearningRelationshipCreation>(
        `/api/featured-learning-maps/${encodeURIComponent(map.mapId)}/learning-relationship`,
        { method: "POST" },
      );
      if (!relationship.learningRelationshipId) {
        setError("未能开启该学径，请稍候重试。");
        return;
      }
      router.push(
        `/learn/${encodeURIComponent(relationship.learningRelationshipId)}`,
      );
    } catch (requestError) {
      if (
        isApiRequestError(requestError) &&
        (requestError.status === 401 ||
          requestError.code === "authentication_required")
      ) {
        router.replace(
          `/auth?next=${encodeURIComponent(`/featured?page=${page}`)}`,
        );
        return;
      }
      if (
        isApiRequestError(requestError) &&
        requestError.code === "resource_not_found"
      ) {
        setError("该地图已更新，正在为你刷新最新版本。");
        setReloadToken((current) => current + 1);
        return;
      }
      setError(featuredErrorMessage(requestError));
    } finally {
      setJoiningMapId(null);
    }
  }

  function changePage(nextPage: number) {
    const lastPage = Math.max(1, Math.ceil(featured.length / PAGE_SIZE));
    const safePage = Math.min(Math.max(nextPage, 1), lastPage);
    setPage(safePage);
    router.push(`/featured?page=${safePage}`);
  }

  const relationshipByMapAndVersion = new Map(
    relationships.map((relationship) => [
      `${relationship.mapId}:${relationship.versionId}`,
      relationship,
    ]),
  );
  const lastPage = Math.max(1, Math.ceil(featured.length / PAGE_SIZE));
  const currentPage = Math.min(Math.max(page, 1), lastPage);
  const visibleFeatured = featured.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  return (
    <div className="app-frame" style={{ minHeight: "100vh" }}>
      <AppHeader email={email} eyebrow="精选航标" />
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
            航标集录
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
            从可靠路径开始
          </h1>
          <p
            style={{
              color: "var(--ink-soft)",
              fontSize: "1.02rem",
              marginTop: 10,
              fontFamily: "var(--font-body)",
            }}
          >
            基于知乎真实讨论提炼、已校验可闭环的学习地图。
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
        ) : featured.length > 0 ? (
          <section aria-label="精选地图列表">
            {/* 无卡片极简条目列表，细虚线分隔 */}
            <List
              dataSource={visibleFeatured}
              renderItem={(item, index) => {
                const relationship = relationshipByMapAndVersion.get(
                  `${item.mapId}:${item.versionId}`,
                );
                const isJoining = joiningMapId === item.mapId;
                return (
                  <ListItem
                    key={`${item.mapId}:${item.versionId}`}
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
                            style={{
                              borderRadius: 12,
                              borderColor: "var(--line)",
                              background: "rgba(251, 246, 236, 0.8)",
                              color: "var(--ink-soft)",
                            }}
                          >
                            {item.nodeCount} 个核心节点
                          </Tag>
                        </div>

                        <Button
                          type={relationship ? "default" : "primary"}
                          onClick={() => void joinFeaturedMap(item)}
                          loading={isJoining}
                          style={{
                            borderRadius: 20,
                            fontFamily: "var(--font-serif)",
                            fontSize: "0.9rem",
                            background: relationship
                              ? "var(--white)"
                              : "var(--primary)",
                            borderColor: relationship
                              ? "var(--line)"
                              : "var(--primary)",
                            color: relationship ? "var(--ink)" : "var(--white)",
                            boxShadow: relationship
                              ? "none"
                              : "0 2px 10px rgba(138, 68, 35, 0.22)",
                          }}
                        >
                          {relationship ? "继续学习" : "加入学习"}
                        </Button>
                      </div>

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
                        {item.title}
                      </h2>

                      <p
                        style={{
                          margin: 0,
                          color: "var(--ink-soft)",
                          lineHeight: 1.8,
                          fontSize: "0.95rem",
                          fontFamily: "var(--font-body)",
                        }}
                      >
                        {item.summary}
                      </p>
                    </article>
                  </ListItem>
                );
              }}
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
                total={featured.length}
                hideOnSinglePage
                showLessItems
                showSizeChanger={false}
                onChange={changePage}
                aria-label="精选地图分页"
              />
            </div>
          </section>
        ) : (
          <Empty
            data-reveal
            description={
              <p style={{ fontFamily: "var(--font-body)" }}>
                暂无可用的航标版本。
              </p>
            }
          />
        )}
      </main>
    </div>
  );
}
