"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";
import { Button, Input } from "antd";

import { AppHeader } from "@/components/app-header";

import styles from "./shell-experience.module.css";

type HomePageProps = Readonly<{
  email: string;
  generationRequestsEnabled: boolean;
}>;

export function HomePage({ email, generationRequestsEnabled }: HomePageProps) {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [topicError, setTopicError] = useState<string | null>(null);

  function submitTopic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!generationRequestsEnabled) {
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

    router.push(`/generate?topic=${encodeURIComponent(normalizedTopic)}`);
  }

  return (
    <div className="app-frame">
      <AppHeader email={email} />
      <main className={styles.homeMain}>
        <section className={styles.homeHero} aria-labelledby="home-title">
          <div className={styles.heroContent}>
            <div className={styles.heroKicker}>
              <span className={styles.kickerDot} aria-hidden="true" />
              学习工作台
            </div>
            <h1 id="home-title">继续你的学习路径</h1>
            <p className={styles.heroLead}>
              把知乎上的真实讨论，走成一条学会的路。
            </p>
            <form
              className={styles.topicForm}
              onSubmit={submitTopic}
              noValidate
            >
              <label className={styles.topicLabel} htmlFor="home-topic">
                你现在想系统弄懂什么？
              </label>
              <div className={styles.topicEntryRow}>
                <Input
                  id="home-topic"
                  className={styles.topicInput}
                  value={topic}
                  onChange={(event) => {
                    setTopic(event.target.value);
                    if (topicError) setTopicError(null);
                  }}
                  maxLength={200}
                  disabled={!generationRequestsEnabled}
                  placeholder={
                    generationRequestsEnabled
                      ? "输入一个具体的学习主题"
                      : "现场生成在本地演示中未启用"
                  }
                  aria-describedby="home-topic-help"
                />
                <Button
                  className={styles.topicSubmit}
                  type="primary"
                  htmlType="submit"
                  disabled={!generationRequestsEnabled}
                >
                  开始主题生成
                </Button>
              </div>
              <div className={styles.topicFormMeta}>
                <span id="home-topic-help">
                  {generationRequestsEnabled
                    ? "服务端将检索真实知乎来源，并在校验完成后建立地图。"
                    : "本地演示未启用现场生成，不会提交主题或创建任务。"}
                </span>
                {generationRequestsEnabled ? (
                  <span>{topic.length}/200</span>
                ) : null}
              </div>
              {topicError ? (
                <p className={styles.topicError} role="alert">
                  {topicError}
                </p>
              ) : null}
              {!generationRequestsEnabled ? (
                <div className={styles.demoGuide}>
                  <span className={styles.demoGuideLabel}>本地演示未启用</span>
                  <span>先从已检查、可追溯的精选地图开始。</span>
                  <Link href="/featured">浏览精选地图</Link>
                </div>
              ) : null}
            </form>
          </div>

          <div className={styles.heroSignature} aria-hidden="true">
            <div className={styles.signatureOrbit} />
            <div className={styles.signatureCross} />
            <svg
              className={styles.signatureGlyph}
              viewBox="0 0 260 220"
              role="presentation"
            >
              <path d="M26 170 84 110l38 30 88-94" />
              <path d="m150 148 35-30 44 12" />
              <circle cx="26" cy="170" r="8" />
              <circle cx="84" cy="110" r="8" />
              <circle cx="122" cy="140" r="8" />
              <circle cx="210" cy="46" r="8" />
              <circle cx="150" cy="148" r="8" />
              <circle cx="185" cy="118" r="8" />
              <circle cx="229" cy="130" r="8" />
            </svg>
            <span className={styles.signatureWordmark}>知径</span>
            <span className={styles.signatureCaption}>从来源到理解</span>
          </div>
        </section>

        <nav className={styles.pathNav} aria-label="学习工作台导航">
          <div className={styles.pathNavHeader}>
            <div>
              <span className={styles.sectionKicker}>三条真实路径</span>
              <h2>从你准备好的地方开始</h2>
            </div>
            <span className={styles.pathNavHint}>
              每一步都保留来源与节点事实
            </span>
          </div>
          <div className={styles.pathGrid}>
            <Link className={styles.pathCard} href="/featured">
              <span className={styles.pathCardTopline}>
                <span className={styles.pathCardIndex} aria-hidden="true">
                  01
                </span>
                <span className={styles.pathCardLabel}>精选地图</span>
              </span>
              <strong>从可靠路径开始</strong>
              <span className={styles.pathCardDescription}>
                浏览人工检查、版本固定、来源可追溯的地图。
              </span>
              <span className={styles.pathFacts}>
                <span>知乎来源</span>
                <span>多观点</span>
                <span>固定版本</span>
              </span>
              <span className={styles.pathCardAction}>
                浏览精选 <span aria-hidden="true">↗</span>
              </span>
            </Link>

            <Link className={styles.pathCard} href="/learning">
              <span className={styles.pathCardTopline}>
                <span className={styles.pathCardIndex} aria-hidden="true">
                  02
                </span>
                <span className={styles.pathCardLabel}>我的学习</span>
              </span>
              <strong>继续已加入的路径</strong>
              <span className={styles.pathCardDescription}>
                打开当前账户保存的学习关系与节点进度。
              </span>
              <span className={styles.pathFacts}>
                <span>学习关系</span>
                <span>节点进度</span>
                <span>跨会话</span>
              </span>
              <span className={styles.pathCardAction}>
                继续学习 <span aria-hidden="true">↗</span>
              </span>
            </Link>

            <Link className={styles.pathCard} href="/generate">
              <span className={styles.pathCardTopline}>
                <span className={styles.pathCardIndex} aria-hidden="true">
                  03
                </span>
                <span className={styles.pathCardLabel}>现场生成</span>
              </span>
              <strong>把问题变成学习地图</strong>
              <span className={styles.pathCardDescription}>
                {generationRequestsEnabled
                  ? "提交主题，服务端检索真实来源并逐阶段校验。"
                  : "本地演示未启用真实供应方和生成 Worker。"}
              </span>
              <span className={styles.pathFacts}>
                <span>阶段状态</span>
                <span>来源校验</span>
                <span>失败可见</span>
              </span>
              <span className={styles.pathCardAction}>
                {generationRequestsEnabled ? "打开生成" : "查看说明"}{" "}
                <span aria-hidden="true">↗</span>
              </span>
            </Link>
          </div>
        </nav>
      </main>
    </div>
  );
}
