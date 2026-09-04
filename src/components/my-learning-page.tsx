"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type CSSProperties } from "react";
import { Alert, Button, Empty, List, Pagination, Skeleton, Tag } from "antd";

import { AppHeader } from "@/components/app-header";
import styles from "@/components/discovery-experience.module.css";
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
    return "服务暂时无法读取学习内容，请稍后重试。";
  }
  return "学习内容暂时不可用，请稍后重试。";
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
    <div className={`app-frame ${styles.page}`}>
      <AppHeader email={email} eyebrow="我的学习" />
      <main className={`directory-main ${styles.pageMain}`}>
        <header className={`directory-heading ${styles.heading}`} data-reveal>
          <div className={styles.headingCopy}>
            <span className="section-kicker">我的学习</span>
            <h1>继续你的学习路径</h1>
            <p>当前账户已保存的学习关系与节点进度。</p>
          </div>
          <div className={styles.headingStamp} aria-hidden="true">
            继续
            <br />
            上路
          </div>
        </header>

        {error ? (
          <Alert
            className={styles.alert}
            data-reveal
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
        ) : relationships.length > 0 ? (
          <section aria-label="我的学习列表" className="directory-content">
            <List
              className={styles.resumeList}
              dataSource={visibleRelationships}
              renderItem={(relationship, index) => (
                <ListItem
                  className={styles.resumeListItem}
                  key={relationship.learningRelationshipId}
                >
                  <article
                    className={styles.resumeCard}
                    data-reveal
                    style={
                      {
                        "--reveal-delay": `${index * 60}ms`,
                      } as CSSProperties
                    }
                  >
                    <Link
                      className={styles.resumeCardLink}
                      href={`/learn/${encodeURIComponent(relationship.learningRelationshipId)}`}
                    >
                      <div className={styles.resumeTopline}>
                        <Tag color="blue">学习中</Tag>
                        <span className={styles.cardIndex} aria-hidden="true">
                          已保存
                        </span>
                      </div>
                      <div className={styles.resumeCardBody}>
                        <strong title={relationship.title}>
                          {relationship.title}
                        </strong>
                        <p title={relationship.summary}>
                          {relationship.summary}
                        </p>
                      </div>
                      <div className={styles.resumeFooter}>
                        <span className={styles.resumeAction}>继续学习 →</span>
                      </div>
                    </Link>
                  </article>
                </ListItem>
              )}
            />
            <div className={styles.pagination} data-reveal>
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
            className={styles.empty}
            data-reveal
            description={
              <div>
                <h2>还没有学习关系</h2>
                <p>先从精选地图加入一条学习路径。</p>
                <Link className="button button-primary" href="/featured">
                  浏览精选地图
                </Link>
              </div>
            }
          />
        )}
      </main>
    </div>
  );
}
