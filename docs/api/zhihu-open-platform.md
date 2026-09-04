# 知乎开放平台外部适配契约

> 状态：一期生产 HTTP 适配器已实现；2026-09-04 已通过生产配置取得成功的知乎搜索响应，并登记线上附加字段兼容规则。本文不记录 Access Secret，也不宣称完整生产生成闭环已经验收。

本文记录知乎供应方协议和知径外部适配边界，不定义知径自己的 HTTP API。供应方 DTO 只存在于 `src/modules/external-providers/infrastructure`，应用模块只能依赖 `public/server.ts` 导出的规范化端口。

## 契约来源与范围

优先级为：知乎官方当前协议和真实响应 > 仓库内官方 Skill 快照 > 本摘要。供应方协议发生变化时，必须更新适配器版本、契约 fixtures 和兼容登记，不得以静默兜底掩盖差异。

- Skill：`zhihu` 0.2.1；公共 HTTP 文档核验日期：2026-07-16；
- 官方资料：[公共 HTTP API](../../.omp/skills/zhihu/references/http-api.md)、[开放平台额度](../../.omp/skills/zhihu/references/open-platform.md)；
- 一期只使用两个公共 HTTP 能力：知乎站内搜索和知乎直答；不调用用户数据、OAuth 或 MCP；
- 当前官方资料没有暴露独立的“正式接口/比赛接口”端点或 DTO；本项目只实现上述统一正式 HTTP 契约，不伪造第二套适配器。若赛事另行提供独立契约，必须新增兼容登记和适配器，并对未识别响应返回 `protocol_error`；
- 开放平台文档当前记载邀测免费额度为知乎搜索 5,000 次/日、知乎直答 100 次/日；同一账号的 Access Secret 与页面/API 请求共享对应额度池，规则可能变化，最终以个人中心用量统计为准。这些是供应方事实而非知径 SLA；适配器不硬编码本地额度、不伪造额度剩余或本地兜底；
- 版本常量由 `EXTERNAL_PROVIDER_VERSIONS` 提供：
  - `sourceAdapterVersion = zhihu-http-2026-07-16-v2`；
  - `modelAdapterVersion = zhida-thinking-1p5-json-2026-09-04-v4`。

## 生产 HTTP 请求

### 公共鉴权

两个端点均由服务端发送以下请求头：

```http
Authorization: Bearer <ZHIHU_ACCESS_SECRET>
X-Request-Timestamp: <Unix 秒级时间戳>
Content-Type: application/json
```

时间戳由服务端时钟注入点计算为秒；适配器不会记录或返回凭据。超时来自项目策略配置，不是知乎供应方 SLA。

### 知乎站内搜索

```http
GET https://developer.zhihu.com/api/v1/content/zhihu_search?Query=<url-encoded-query>&Count=<count>
```

`Query` 必须是非空文本。适配器遵循官方边界：`Count <= 0` 按 10 发送，`Count > 10` 截断为 10；非整数、空请求 ID 或无效超时在本地拒绝。响应必须是严格的 JSON 对象：

```json
{
  "Code": 0,
  "Message": "success",
  "Data": {
    "HasMore": false,
    "SearchHashId": "search-id",
    "Items": []
  }
}
```

成功 Item 的必要事实为 `Title`、`ContentType`、`ContentID`、`ContentText`、`Url`、`CommentCount`、`VoteUpCount`、`AuthorName`、`AuthorAvatar`、`AuthorBadge`、`AuthorBadgeText`、`EditTime`、`AuthorityLevel`、`RankingScore`。`CommentInfoList` 若存在，元素必须包含 `Content`。线上响应可能附带 `AuthorSignature`；适配器将它作为已知可选元数据接受，但不写入规范化 DTO。除该已登记字段外，未知字段、缺字段或类型错误均不能伪装成空结果。

适配器只向应用输出以下规范化来源 DTO，不输出知乎原始 DTO：

```ts
type NormalizedSource = {
  sourceId: string;
  title: string;
  excerpt: string;
  url: string;
  authorName: string;
  contentType: "answer" | "article" | "question";
  updatedAt: number; // Unix 秒
  authorityLevel: "low" | "medium" | "high" | "very_high";
  rankingScore: number;
};
```

`ContentType` 的允许官方值为 `Answer`、`Article`、`Question`，分别转换为小写封闭枚举；知乎搜索契约之外的 `Zvideo`、`Pin` 或其他值均显式返回 `protocol_error`。`AuthorityLevel` 的官方字符串 `1`、`2`、`3`、`4` 分别转换为 `low`、`medium`、`high`、`very_high`。其他值显式返回 `protocol_error`。

来源 URL 必须为 HTTPS，主机必须是 `zhihu.com` 或其子域名，且不能包含用户名、密码或端口。适配器只执行结构校验和标准 URL 序列化，保留供应方 URL 的路径、查询参数（包括 `utm_*` 等溯源参数）和 fragment，不把 URL 当作业务 canonical。`sourceId` 由官方 `ContentType`（转换为封闭小写枚举）与 `ContentID` 组合派生，避免不同内容类型的 ID 命名空间碰撞；生成聚合按 `sourceId` 去重。更深层的规范身份及同内容跨 ID 去重规则仍待产品/供应方决策，不能由适配器自行宣称已确定。

适配器返回 `{ searchId, sources }`。官方允许成功空列表；空列表与鉴权失败、限流和配额失败是不同结果。

### 知乎直答

一期供应商和模型已冻结为知乎直答 `zhida-thinking-1p5`。官方只保证 `model`、`messages`、`stream` 三个请求字段，适配器实际只发送：

```json
{
  "model": "zhida-thinking-1p5",
  "messages": [{ "role": "user", "content": "JSON-only task prompt" }],
  "stream": false
}
```

适配器不发送 `response_format`、原生 JSON Schema、temperature 或其他未被官方保证的 OpenAI 风格字段。四种用途分别产生明确 JSON-only 提示并使用用途专属 Zod schema：

- `planDirections`：3–4 个 `{ directionId, title, objective, searchQuery }`；
- `structureMap`：5–7 个节点及 `nodeId`/`prerequisiteNodeId` 先修边；
- `extractViewpoints`：只投影节点证据关系及来源标题/摘要，生成带 `nodeId`、封闭观点类型和 `sourceIds` 的观点；材料不能支持观点时返回空 `viewpoints`，不得改用解释性正文；
- `generateAssessments`：四种题型（`single_choice`、`multiple_choice`、`matching`、`opinion_analysis`），均带选项、解释和 `sourceIds`，并按题型带严格互斥的答案字段。

`generateAssessments` 的题目对象严格按 `type` 选择答案字段：

- `single_choice`：`correctOptionIds` 必须恰有一个选项 ID，不能有 `correctMatches`；
- `multiple_choice`：`correctOptionIds` 必须至少有一个选项 ID，不能有 `correctMatches`；
- `matching`：`correctMatches` 必须至少有一对 `{ leftOptionId, rightOptionId }`，不能有 `correctOptionIds`；两端 ID 都必须来自 `options`，左右两侧各自不能重复，且一对不能指向同一选项；
- `opinion_analysis`：`correctOptionIds` 必须恰有一个选项 ID，不能有 `correctMatches`。

模型返回必须包含非空 `choices[0].message.content`，`finish_reason` 必须是 `stop`，且响应模型 ID 必须仍为 `zhida-thinking-1p5`。先严格解析响应，再解析 content 中的 JSON，最后执行用途专属 schema 和业务关系门禁：

- 只能引用输入中的节点 ID、来源 ID 和选项 ID；
- 观点来源必须属于对应节点；题目来源必须属于对应节点；
- 先修边端点必须存在、不能自环、不能重复且整体无环；
- 四种题型的答案字段必须与上述 `type` 规则完全匹配；未知字段、缺失字段、错误数量或两种答案字段同时出现均失败；
- `reasoning_content` 永远不作为结果；
- URL 字段不是任何模型输出 schema 的成员，出现即失败。

模型内容不是可信输入。适配器只去除首尾空白/一个前导 BOM，或在首尾严格匹配且内容完整唯一时去除一层 `json` Markdown 围栏；普通文本、拒答文本、任意花括号片段、残缺或重复围栏均返回稳定 `protocol_error`，不静默删除字段后继续。观点提示会把地图与来源标记为不可信数据，并明确使用空数组表达“没有受证据支持的观点”，避免把事实不足转写为协议外说明。

## 错误和重试语义

应用只接收 `ExternalProviderError`：`provider` 为 `source` 或 `model`，`code` 为以下稳定值，且不携带响应正文：

| 供应方事实                                       | 内部 code                 | retryable |
| ------------------------------------------------ | ------------------------- | --------- |
| 参数错误、缺参数或明确 invalid request           | `invalid_request`         | 否        |
| HTTP 401/403、`20001`、`invalid_api_key`         | `authentication_failed`   | 否        |
| HTTP 429、`30001` 或 rate limit                  | `rate_limited`            | 是        |
| HTTP 402、`30002` 或 quota                       | `quota_exhausted`         | 否        |
| HTTP 5xx、`90001`、server/internal unavailable   | `temporarily_unavailable` | 是        |
| 请求 Abort/超时或明确 timeout                    | `timeout`                 | 是        |
| 成功状态但响应结构、必要字段、枚举或模型关系不符 | `protocol_error`          | 否        |

HTTP 状态和供应方业务码都参与映射；状态码优先识别明确的鉴权、限流、配额、超时和 5xx 语义，其余再按业务码解析。可解析的 `Retry-After` 会作为 `retryAfterMs` 返回；不保存响应正文。适配器自身不重试；上层只对瞬时外部失败沿用每阶段最多两次重试：知乎直答在供应方没有返回 `Retry-After` 时按 5 秒、10 秒退避，来源搜索按 250 毫秒、500 毫秒退避，供应方给出的更长等待时间优先。`protocol_error` 由任务级生成恢复策略处理（模型阶段最多 3 次总尝试、全任务最多 3 次额外恢复）。

## 配置

以下变量只在服务端读取，全部必填：

```dotenv
ZHIHU_ACCESS_SECRET=replace-with-a-real-server-access-secret
ZHIHU_MODEL=zhida-thinking-1p5
ZHIHU_SOURCE_TIMEOUT_MS=15000
ZHIHU_MODEL_TIMEOUT_MS=30000
```

`ZHIHU_MODEL` 不是可任意切换的供应商参数；当前只接受冻结值 `zhida-thinking-1p5`。超时是知径项目策略（上限 600000ms），必须同时受生成任务剩余时间约束。环境缺失、空白、未知模型或无效超时显式失败，不提供生产默认密钥。

## Fixtures 与在线采样事实

`src/modules/external-providers/infrastructure/fixtures.ts` 中的搜索成功/空结果响应 envelope、缺字段和未知枚举数据来自官方 Skill 0.2.1/2026-07-16 文档样本并明确不是本项目在线采样；`ZHIHU_SEARCH_ADDITIVE_METADATA_FIXTURE` 是根据 2026-09-04 生产诊断观察到的 `AuthorSignature` 附加字段构造的脱敏兼容夹具；直答 fixture 仅复用官方非流式响应 envelope，content 是供 schema 测试使用的合成 JSON，同样不是在线采样。`REAL_AUTH_FAILURE_FIXTURE` 记录了 2026-09-02 的脱敏无密钥探针事实：

- 搜索请求未发送 Authorization/Timestamp，HTTP 200，`Code=20001`、`Message=Authorization failed`、`Data=null`；
- 直答请求未发送 Authorization/Timestamp，合法 `model/messages/stream=false`，HTTP 401，错误 `code=invalid_api_key`、`type=authentication_error`；
- 动态响应头、Cookie、request-id 和任何凭据均未保存。

2026-09-04 的生产诊断已使用受控服务端配置取得成功搜索响应（HTTP 200、`Code=0`、5 条结果），确认线上条目包含已登记的 `AuthorSignature` 附加字段；直答诊断观察到一次合法 HTTP 200 envelope 携带短拒答正文，以及一次约 60 秒后的 HTTP 504，二者均不属于结构化成功样本，也未保存原始响应、Access Secret 或动态请求信息。成功空结果、限流/配额在线样本和直答结构化成功响应仍未取得；契约测试使用脱敏官方 fixtures、兼容夹具与稳定人工构造错误响应，不能替代完整真实生成闭环验收。

## 兼容登记

| 编号   | 边界                                     | 当前支持                                                                                                                            | 失败方式                                          | 移除/复核条件                      |
| ------ | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------- |
| ZH-001 | 知乎站内搜索 HTTP → `SourceSearchAccess` | 官方 Skill 0.2.1/2026-07-16 字段、封闭枚举及已观察的 `AuthorSignature` 可选附加字段                                                 | 必要字段、URL、枚举或 HTTP/业务错误不符时显式失败 | 官方字段或端点变化并完成版本迁移   |
| ZH-002 | 知乎直答 HTTP → `StructuredModelAccess`  | `zhida-thinking-1p5`、`model/messages/stream=false`、JSON-only 提示、观点紧凑证据投影/空数组语义、四种题型严格答案变体和用途 schema | 非 JSON、未知 ID/URL、关系不闭合或错误映射失败    | 模型版本冻结解除并完成新适配器契约 |

该适配器不实现知乎 OAuth 登录、不读取用户数据接口、不使用 MCP 文本替代结构化 HTTP 来源。
