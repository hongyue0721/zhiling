"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { Alert, Button, Input } from "antd";

import { AppHeader } from "@/components/app-header";
import { ThreeLoadingOrb } from "@/components/three-loading-orb";
import { apiRequest, isApiRequestError } from "@/shared/ui/api-client";
import type { SafeGenerationEvent } from "@/components/contracts";

type HomePageProps = Readonly<{
  email: string;
  generationRequestsEnabled: boolean;
}>;

const humanStepLabels: Record<string, string> = {
  queued: "正在就绪，准备开启探索...",
  normalizing: "正在理顺你的学习主题...",
  cache_lookup: "正在翻阅已有知识记录...",
  planning: "正在规划核心学习路径...",
  searching: "正在检索知乎上的真实经验与讨论...",
  structuring: "正在组织前后关联的知识节点...",
  supplementing: "正在补充关键视角与背景材料...",
  extracting: "正在提炼不同的观点与实践经验...",
  assessing: "正在为你编排答题检验题目...",
  validating: "正在校验地图完整性与证据来源...",
  publishing: "正在收尾生成你的专属学习地图...",
  succeeded: "学习地图已编织完成！",
  failed: "生成遇到阻碍，请换个更具体的方向试试。",
};

const stepProgressMap: Record<string, number> = {
  queued: 8,
  normalizing: 16,
  cache_lookup: 24,
  planning: 36,
  searching: 50,
  structuring: 62,
  supplementing: 72,
  extracting: 80,
  assessing: 88,
  validating: 94,
  publishing: 98,
  succeeded: 100,
};

type CreationState = "search" | "generating" | "complete" | "failed";

export function HomePage({ email, generationRequestsEnabled }: HomePageProps) {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [creationState, setCreationState] = useState<CreationState>("search");
  const [currentStepText, setCurrentStepText] = useState("正在启程...");
  const [progressPercent, setProgressPercent] = useState(10);
  const [learningRelationshipId, setLearningRelationshipId] = useState<
    string | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  async function handleSearch(e: FormEvent) {
    e.preventDefault();
    const cleanTopic = topic.trim();
    if (!cleanTopic) return;

    if (!generationRequestsEnabled) {
      setError("演示环境未开放自由生成，请点击顶栏「精选航标」浏览已有地图。");
      return;
    }

    setError(null);
    setCreationState("generating");
    setCurrentStepText("正在发起探索请求...");
    setProgressPercent(10);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      // 1. 发起生成任务
      const response = await apiRequest<{
        snapshot: {
          taskId: string;
          status: string;
          sequence: number;
          result?: { learningRelationshipId: string };
        };
      }>("/api/map-generations", {
        method: "POST",
        body: JSON.stringify({ topic: cleanTopic }),
        signal: controller.signal,
      });

      const { taskId, result } = response.snapshot;

      if (result?.learningRelationshipId) {
        setLearningRelationshipId(result.learningRelationshipId);
        setProgressPercent(100);
        setCurrentStepText("地图已存在，随时可以开启！");
        setCreationState("complete");
        return;
      }

      // 2. 监听 SSE 流
      await listenEvents(taskId, response.snapshot.sequence, controller.signal);
    } catch (err) {
      if (controller.signal.aborted) return;
      if (isApiRequestError(err)) {
        setError(err.message || "生成遇到问题，请重试。");
      } else {
        setError("网络连接稍有异常，请稍后重试。");
      }
      setCreationState("failed");
    }
  }

  async function listenEvents(
    taskId: string,
    initialSeq: number,
    signal: AbortSignal,
  ) {
    let sequence = initialSeq;
    const res = await fetch(
      `/api/map-generations/${encodeURIComponent(taskId)}/events`,
      {
        headers: {
          Accept: "text/event-stream",
          "Last-Event-ID": String(sequence),
        },
        credentials: "include",
        cache: "no-store",
        signal,
      },
    );

    if (!res.ok || !res.body) {
      throw new Error("无法建立生成进度连接");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";

      for (const block of blocks) {
        const lines = block.split("\n");
        let eventData = "";

        for (const line of lines) {
          if (line.startsWith("data:")) {
            eventData = line.slice(5).trim();
          }
        }

        if (!eventData) continue;
        try {
          const parsed = JSON.parse(eventData) as SafeGenerationEvent;
          if (parsed.sequence) sequence = parsed.sequence;

          if (
            parsed.type === "progress" &&
            typeof parsed.data?.status === "string"
          ) {
            const status = parsed.data.status;
            setCurrentStepText(humanStepLabels[status] ?? `进行中：${status}`);
            setProgressPercent(stepProgressMap[status] ?? 60);
          } else if (parsed.type === "succeeded") {
            const relId =
              typeof parsed.data?.learningRelationshipId === "string"
                ? parsed.data.learningRelationshipId
                : null;
            if (relId) {
              setLearningRelationshipId(relId);
              setProgressPercent(100);
              setCurrentStepText("学习地图已编织就绪！");
              setCreationState("complete");
              return;
            }
          } else if (parsed.type === "failed") {
            setError(humanStepLabels.failed);
            setCreationState("failed");
            return;
          }
        } catch {
          // ignore json parse error
        }
      }
    }
  }

  return (
    <div
      className="app-frame"
      style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}
    >
      <AppHeader email={email} />

      <main
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "40px 24px 80px",
          maxWidth: 820,
          margin: "0 auto",
          width: "100%",
          textAlign: "center",
          position: "relative",
          zIndex: 1,
        }}
      >
        {/* 仅展示搜索框及文字：“感兴趣的学习方向” */}
        {creationState === "search" && (
          <div
            style={{
              width: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 28,
              animation: "fadeInUp 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) both",
            }}
          >
            <h1
              aria-label="继续你的学习路径"
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: "clamp(2rem, 3.8vw, 2.9rem)",
                fontWeight: 400,
                color: "var(--ink)",
                letterSpacing: "0.04em",
                margin: 0,
                lineHeight: 1.35,
              }}
            >
              感兴趣的学习方向
            </h1>

            <form
              onSubmit={handleSearch}
              style={{
                width: "100%",
                maxWidth: 600,
                position: "relative",
                display: "flex",
                alignItems: "center",
              }}
            >
              <Input
                value={topic}
                onChange={(e) => {
                  setTopic(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="例如：TypeScript 泛型、分布式事务、微服务缓存设计..."
                maxLength={200}
                style={{
                  height: 56,
                  borderRadius: 28,
                  fontSize: "1.08rem",
                  fontFamily: "var(--font-body)",
                  paddingLeft: 26,
                  paddingRight: 110,
                  background: "rgba(253, 250, 243, 0.92)",
                  border: "1px solid var(--line)",
                  boxShadow: "0 4px 20px rgba(43, 36, 28, 0.05)",
                  color: "var(--ink)",
                  outline: "none",
                }}
              />
              <Button
                type="primary"
                htmlType="submit"
                style={{
                  position: "absolute",
                  right: 6,
                  height: 44,
                  paddingInline: 22,
                  borderRadius: 22,
                  fontSize: "0.95rem",
                  fontFamily: "var(--font-serif)",
                  background: "var(--primary)",
                  border: "none",
                  boxShadow: "0 2px 10px rgba(138, 68, 35, 0.25)",
                }}
              >
                搜索 ↗
              </Button>
            </form>

            {error && (
              <div style={{ maxWidth: 480, marginTop: 8 }}>
                <Alert
                  type="warning"
                  showIcon
                  message={error}
                  style={{
                    background: "var(--paper-deep)",
                    border: "1px dashed var(--line)",
                  }}
                />
              </div>
            )}
          </div>
        )}

        {/* 搜索后搜索框隐入消失，原地呈现可被鼠标扰动打乱又恢复的 Three.js 粒子加载星盘 */}
        {(creationState === "generating" || creationState === "complete") && (
          <div
            style={{
              animation: "fadeInScale 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) both",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <ThreeLoadingOrb
              currentStepText={currentStepText}
              progressPercent={progressPercent}
              isComplete={creationState === "complete"}
              onEnterMap={() => {
                if (learningRelationshipId) {
                  router.push(
                    `/learn/${encodeURIComponent(learningRelationshipId)}`,
                  );
                }
              }}
              enterButtonText="步入学习地图 ↗"
            />
          </div>
        )}

        {/* 失败状态 */}
        {creationState === "failed" && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 16,
            }}
          >
            <Alert
              type="error"
              showIcon
              message={error || "生成未完成"}
              style={{
                background: "rgba(166, 58, 47, 0.08)",
                border: "1px solid var(--danger)",
              }}
            />
            <Button
              onClick={() => {
                setCreationState("search");
                setError(null);
              }}
              style={{ borderRadius: 20 }}
            >
              换个主题试试
            </Button>
          </div>
        )}
      </main>

      <style jsx>{`
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: none;
          }
        }
        @keyframes fadeInScale {
          from {
            opacity: 0;
            transform: scale(0.92);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
      `}</style>
    </div>
  );
}
