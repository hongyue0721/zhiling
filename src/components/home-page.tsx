"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";

import { AppHeader } from "@/components/app-header";
import { apiRequest, isApiRequestError } from "@/shared/ui/api-client";
import type {
  FeaturedLearningMapSummary,
  LearningRelationshipCreation,
  LearningRelationshipList,
  LearningRelationshipSummary,
} from "@/components/contracts";

type HomePageProps = Readonly<{
  email: string;
  generationRequestsEnabled: boolean;
}>;

function pageErrorMessage(error: unknown): string {
  if (!isApiRequestError(error)) {
    return "网络连接失败，请稍后重试。";
  }
  if (error.status === 401 || error.code === "authentication_required") {
    return "登录状态已失效，请重新登录。";
  }
  if (error.status >= 500) {
    return "服务暂时无法读取学习内容，请稍后重试。";
  }
  return "学习内容暂时不可用，请稍后重试。";
}

export function HomePage({ email, generationRequestsEnabled }: HomePageProps) {
  const router = useRouter();
  const [featured, setFeatured] = useState<
    readonly FeaturedLearningMapSummary[]
  >([]);
  const [relationships, setRelationships] = useState<
    readonly LearningRelationshipSummary[]
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [joiningMapId, setJoiningMapId] = useState<string | null>(null);
  const [topic, setTopic] = useState("");
  const [topicError, setTopicError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadHome() {
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
        if (cancelled) {
          return;
        }
        if (
          isApiRequestError(requestError) &&
          (requestError.status === 401 ||
            requestError.code === "authentication_required")
        ) {
          router.replace("/auth?next=/");
          return;
        }
        setError(pageErrorMessage(requestError));
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadHome();
    return () => {
      cancelled = true;
    };
  }, [reloadToken, router]);

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
        router.replace("/auth?next=/");
        return;
      }
      if (
        isApiRequestError(requestError) &&
        requestError.code === "resource_not_found"
      ) {
        setError("精选地图不存在或已下架，请刷新后重试。");
        return;
      }
      setError(pageErrorMessage(requestError));
    } finally {
      setJoiningMapId(null);
    }
  }

  function openGenerator(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!generationRequestsEnabled) {
      setTopicError(
        "本地演示未启动真实供应方和生成 Worker，现场生成不会接收任务。",
      );
      return;
    }
    const normalizedTopic = topic.trim();
    if (!normalizedTopic) {
      setTopicError("请输入你想系统学习的主题。");
      return;
    }
    if (normalizedTopic.length > 200) {
      setTopicError("主题不能超过 200 个字符。");
      return;
    }
    setTopicError(null);
    router.push(`/generate?topic=${encodeURIComponent(normalizedTopic)}`);
  }

  const relationshipByMapAndVersion = new Map(
    relationships.map((relationship) => [
      `${relationship.mapId}:${relationship.versionId}`,
      relationship,
    ]),
  );

  return (
    <div className="app-frame">
      <AppHeader email={email} />
      <main className="home-main">
        <section className="home-hero" aria-labelledby="home-title">
          <div className="home-hero-copy">
            <span className="section-kicker">你的学习工作台</span>
            <h1 id="home-title">把零散讨论，走成一条学会的路。</h1>
            <p>
              {generationRequestsEnabled
                ? "从经过检查的精选地图开始，或输入主题现场生成。每个节点都连接到真实知乎来源，并用服务端验证留下你的学习进度。"
                : "本地演示使用固定学习地图体验加入、学习、验证与报告；不会伪造真实供应方或现场生成结果。"}
            </p>
          </div>
          <div className="home-hero-note" aria-label="知径学习方式">
            <span className="hero-note-number">01</span>
            <span>先理解路径</span>
            <span>再验证掌握</span>
          </div>
        </section>

        {error ? (
          <div className="page-alert" role="alert">
            <span>{error}</span>
            <button
              type="button"
              className="button button-small button-secondary"
              onClick={() => setReloadToken((current) => current + 1)}
            >
              刷新
            </button>
          </div>
        ) : null}

        <section className="home-section" aria-labelledby="featured-title">
          <div className="section-heading-row">
            <div>
              <span className="section-kicker">精选地图</span>
              <h2 id="featured-title">从可靠路径开始</h2>
            </div>
            <span className="section-caption">
              人工检查 · 固定版本 · 可追溯来源
            </span>
          </div>
          {isLoading ? (
            <div
              className="card-grid"
              aria-label="正在加载精选地图"
              aria-busy="true"
            >
              <div className="loading-card" />
              <div className="loading-card" />
              <div className="loading-card" />
            </div>
          ) : featured.length > 0 ? (
            <div className="card-grid">
              {featured.map((map) => {
                const relationship = relationshipByMapAndVersion.get(
                  `${map.mapId}:${map.versionId}`,
                );
                const isJoining = joiningMapId === map.mapId;
                return (
                  <article
                    className="learning-card"
                    key={`${map.mapId}:${map.versionId}`}
                  >
                    <div className="learning-card-topline">
                      <span className="card-index" aria-hidden="true">
                        {String(featured.indexOf(map) + 1).padStart(2, "0")}
                      </span>
                      <span className="card-meta">{map.nodeCount} 个节点</span>
                    </div>
                    <h3>{map.title}</h3>
                    <p>{map.summary}</p>
                    <div className="learning-card-footer">
                      <span className="card-version">已发布地图</span>
                      <button
                        type="button"
                        className="button button-secondary"
                        onClick={() => void joinFeaturedMap(map)}
                        disabled={isJoining}
                      >
                        {isJoining
                          ? "准备中…"
                          : relationship
                            ? "继续学习"
                            : "加入学习"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="empty-panel">
              <span className="empty-panel-mark" aria-hidden="true">
                —
              </span>
              <h3>精选地图正在准备中</h3>
              <p>
                当前没有可用的精选版本。你仍然可以从下方输入主题，提交一次真实生成任务。
              </p>
            </div>
          )}
        </section>

        <section
          className="home-section relationship-section"
          aria-labelledby="relationship-title"
        >
          <div className="section-heading-row">
            <div>
              <span className="section-kicker">我的学习关系</span>
              <h2 id="relationship-title">跨设备继续</h2>
            </div>
            <span className="section-caption">进度由你的正式账户保存</span>
          </div>
          {isLoading ? (
            <div className="relationship-loading" aria-hidden="true" />
          ) : relationships.length > 0 ? (
            <div className="relationship-list">
              {relationships.map((relationship) => (
                <Link
                  className="relationship-row"
                  href={`/learn/${encodeURIComponent(relationship.learningRelationshipId)}`}
                  key={relationship.learningRelationshipId}
                >
                  <span className="relationship-row-copy">
                    <strong>{relationship.title}</strong>
                    <span>{relationship.summary}</span>
                  </span>
                  <span className="relationship-row-action">继续 →</span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="empty-panel empty-panel-compact">
              <h3>还没有学习关系</h3>
              <p>
                {generationRequestsEnabled
                  ? "加入精选地图或提交一个现场生成主题后，学习进度会在这里持续可见。"
                  : "加入上方固定演示地图后，学习进度会在这里持续可见。"}
              </p>
            </div>
          )}
        </section>

        <section
          className="generator-callout"
          aria-labelledby="generator-title"
        >
          <div className="generator-callout-copy">
            <span className="section-kicker">现场生成</span>
            <h2 id="generator-title">你现在想弄懂什么？</h2>
            <p>
              {generationRequestsEnabled
                ? "任务会在服务端检索真实来源并逐阶段校验。生成期间可以安全恢复，材料不足或外部服务不可用时会明确告诉你。"
                : "本地演示未启动真实供应方和生成 Worker；请使用上方固定学习地图体验完整学习流程。"}
            </p>
          </div>
          <form className="topic-form" onSubmit={openGenerator} noValidate>
            <label className="field-label" htmlFor="home-topic">
              学习主题
            </label>
            <div className="topic-form-row">
              <input
                id="home-topic"
                className="field-input"
                value={topic}
                onChange={(event) => {
                  setTopic(event.target.value);
                  if (topicError) setTopicError(null);
                }}
                placeholder="例如：如何设计可靠的缓存系统"
                maxLength={200}
                disabled={!generationRequestsEnabled}
              />
              <button
                type="submit"
                className="button button-primary"
                disabled={!generationRequestsEnabled}
              >
                {generationRequestsEnabled ? "进入生成" : "本地演示未启用"}
              </button>
            </div>
            {topicError ? (
              <p className="form-message form-message-error" role="alert">
                {topicError}
              </p>
            ) : null}
            {!generationRequestsEnabled ? (
              <p className="form-message form-message-info" role="status">
                现场生成不会接收任务，也不会留下无法处理的排队任务。
              </p>
            ) : null}
          </form>
        </section>
      </main>
    </div>
  );
}
