"use client";

import Link from "next/link";
import { Tag } from "antd";

import { AppHeader } from "@/components/app-header";

type HomePageProps = Readonly<{
  email: string;
  generationRequestsEnabled: boolean;
}>;

export function HomePage({ email, generationRequestsEnabled }: HomePageProps) {
  return (
    <div className="app-frame">
      <AppHeader email={email} />
      <main className="home-main home-dashboard">
        <section className="home-hero" aria-labelledby="home-title">
          <div className="home-hero-copy">
            <span className="section-kicker">学习工作台</span>
            <h1 id="home-title">继续你的学习路径</h1>
            <p>从精选地图、我的学习或现场生成开始。</p>
          </div>
        </section>

        <nav className="home-action-list" aria-label="学习工作台导航">
          <Link className="home-action-row" href="/featured">
            <span className="home-action-index" aria-hidden="true">
              01
            </span>
            <span className="home-action-copy">
              <span className="section-kicker">精选地图</span>
              <strong>从可靠路径开始</strong>
              <span>浏览人工检查、版本固定、来源可追溯的地图。</span>
            </span>
            <span className="home-action-link">浏览精选 →</span>
          </Link>

          <Link className="home-action-row" href="/learning">
            <span className="home-action-index" aria-hidden="true">
              02
            </span>
            <span className="home-action-copy">
              <span className="section-kicker">我的学习</span>
              <strong>继续已加入的路径</strong>
              <span>打开当前账户保存的学习关系与节点进度。</span>
            </span>
            <span className="home-action-link">继续学习 →</span>
          </Link>

          <Link className="home-action-row" href="/generate">
            <span className="home-action-index" aria-hidden="true">
              03
            </span>
            <span className="home-action-copy">
              <span className="section-kicker">现场生成</span>
              <strong>你现在想弄懂什么？</strong>
              <span>
                {generationRequestsEnabled
                  ? "提交主题，服务端检索真实来源并逐阶段校验。"
                  : "本地演示未启动真实供应方和生成 Worker。"}
              </span>
            </span>
            <span className="home-action-link">
              {!generationRequestsEnabled ? (
                <Tag color="blue">本地演示</Tag>
              ) : null}
              打开生成 →
            </span>
          </Link>
        </nav>
      </main>
    </div>
  );
}
