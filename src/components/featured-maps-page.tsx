"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Alert, Button, Empty, List, Pagination, Skeleton, Tag } from "antd";

import { AppHeader } from "@/components/app-header";
import styles from "@/components/discovery-experience.module.css";
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
    return "服务暂时无法读取精选地图，请稍后重试。";
  }
  return "精选地图暂时不可用，请稍后重试。";
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
        setError("学习关系未能建立，请稍后重试。");
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
        router.replace("/auth?next=/featured");
        return;
      }
      if (
        isApiRequestError(requestError) &&
        requestError.code === "resource_not_found"
      ) {
        setError("精选地图不存在或已下架，请刷新后重试。");
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
    <div className={`app-frame ${styles.page}`}>
      <AppHeader email={email} eyebrow="精选地图" />
      <main className={`directory-main ${styles.pageMain}`}>
        <header className={`directory-heading ${styles.heading}`}>
          <div className={styles.headingCopy}>
            <span className="section-kicker">精选地图</span>
            <h1>从可靠路径开始</h1>
            <p>人工检查、版本固定、来源可追溯。</p>
          </div>
          <div className={styles.headingStamp} aria-hidden="true">
            路线
            <br />
            索引
          </div>
        </header>

        {error ? (
          <Alert
            className={styles.alert}
            role="alert"
            type="error"
            showIcon
            message={error}
            action={
              <Button
                size="small"
                onClick={() => setReloadToken((current) => current + 1)}
              >
                刷新
              </Button>
            }
          />
        ) : null}

        {isLoading ? (
          <div className={styles.loading} aria-busy="true">
            <Skeleton active paragraph={{ rows: 8 }} />
          </div>
        ) : featured.length > 0 ? (
          <section aria-label="精选地图列表" className="directory-content">
            <List
              className={styles.cardList}
              dataSource={visibleFeatured}
              renderItem={(map, index) => {
                const relationship = relationshipByMapAndVersion.get(
                  `${map.mapId}:${map.versionId}`,
                );
                const isJoining = joiningMapId === map.mapId;
                return (
                  <ListItem
                    className={styles.cardListItem}
                    key={`${map.mapId}:${map.versionId}`}
                  >
                    <article className={styles.directionCard}>
                      <div className={styles.cardTopline}>
                        <span className={styles.cardIndex} aria-hidden="true">
                          {String(
                            (currentPage - 1) * PAGE_SIZE + index + 1,
                          ).padStart(2, "0")}
                        </span>
                        <Tag color="blue">已发布地图</Tag>
                      </div>
                      <div className={styles.cardCopy}>
                        <h2 title={map.title}>{map.title}</h2>
                        <p title={map.summary}>{map.summary}</p>
                      </div>
                      <div className={styles.cardFooter}>
                        <span className={styles.cardFooterFact}>
                          {map.nodeCount} 个节点
                        </span>
                        <Button
                          type={relationship ? "default" : "primary"}
                          onClick={() => void joinFeaturedMap(map)}
                          loading={isJoining}
                        >
                          {relationship ? "继续学习" : "加入学习"}
                        </Button>
                      </div>
                    </article>
                  </ListItem>
                );
              }}
            />
            <div className={styles.pagination}>
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
            className={styles.empty}
            description={
              <div>
                <h2>精选地图正在准备中</h2>
                <p>当前没有可用的精选版本。</p>
              </div>
            }
          />
        )}
      </main>
    </div>
  );
}
