export const statusText: Record<string, string> = {
  idle: "从好奇，出发。",
  queued: "准备出发",
  normalizing: "理解问题",
  cache_lookup: "寻找地图",
  planning: "规划方向",
  searching: "寻找线索",
  structuring: "编织路径",
  supplementing: "补充线索",
  extracting: "连接观点",
  assessing: "构造问题",
  validating: "校验地图",
  publishing: "展开地图",
  succeeded: "地图已就绪",
  failed: "生成未完成",
};
export const failureText: Record<string, string> = {
  invalid_topic: "请缩小主题后重试。",
  source_unavailable: "来源服务暂时不可用。",
  source_insufficient: "这个主题的材料还不够。",
  model_unavailable: "模型服务暂时不可用。",
  candidate_invalid: "生成内容未通过校验。",
  generation_timeout: "本次生成已超时。",
  internal_failure: "本次生成未完成。",
};

export function generationMode(
  status: string,
): "generating" | "searching" | "structuring" | "checking" {
  if (["assessing", "validating", "publishing"].includes(status))
    return "checking";
  if (["structuring", "supplementing", "extracting"].includes(status))
    return "structuring";
  if (status === "searching") return "searching";
  return "generating";
}
