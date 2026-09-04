# 兼容性策略

兼容层用于隔离已知差异，不是无限期兜底。每个兼容项必须登记支持范围、转换前置条件、信息损失和失败语义；未知字段、无效枚举、必要事实缺失和关系缺失不得被静默吞掉。

## 兼容项要求

1. 明确源契约、目标契约和支持版本范围；
2. 定义转换前置条件、信息损失和失败语义；
3. 保留可观测指标，能够识别仍在使用旧行为的调用方；
4. 指定负责人、引入日期、废弃条件和计划移除版本；
5. 同时覆盖契约测试、转换测试和不支持场景测试。

## 兼容项登记表

| 编号    | 边界                                     | 支持范围                                                                                                                                                                                                                                                                                                            | 失败语义                                                                                                                                                                                         | 负责人       | 引入       | 复核/移除条件                                                 | 状态                                                            |
| ------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ | ---------- | ------------------------------------------------------------- | --------------------------------------------------------------- |
| ZH-001  | 知乎站内搜索 HTTP → `SourceSearchAccess` | `GET https://developer.zhihu.com/api/v1/content/zhihu_search`；官方 `zhihu` Skill 0.2.1/2026-07-16 契约；ContentType `Answer/Article/Question` 和 AuthorityLevel `1..4` 的封闭转换。当前官方资料没有独立“正式接口/比赛接口”端点或 DTO，故只实现该统一正式契约；赛事若另行提供契约，必须新增兼容项，不伪造第二套实现 | 必要字段、严格 JSON、URL HTTPS/知乎主机、未知枚举（包括 `Zvideo`/`Pin`）、HTTP 状态或业务 `Code` 不符时返回 `ExternalProviderError(protocol_error)` 或稳定错误类别；空列表仅在合法成功响应时允许 | 外部适配模块 | 2026-09-02 | 官方端点/字段或枚举变化，或新增赛事契约并完成新版本适配和迁移 | 已实现；成功在线样本待 Access Secret                            |
| ZH-002  | 知乎直答 HTTP → `StructuredModelAccess`  | `POST https://developer.zhihu.com/v1/chat/completions`；模型冻结 `zhida-thinking-1p5`；仅 `model/messages/stream=false`；JSON-only 提示；观点使用紧凑证据投影并以空数组表达无可靠观点；用途专属 schema                                                                                                              | `choices[0].message.content` 缺失、非 JSON、未知 ID/URL、枚举错误、答案/来源/节点关系不闭合时返回 `protocol_error`；`reasoning_content` 不作为结果                                               | 外部适配模块 | 2026-09-02 | 模型版本或官方请求能力变化，完成新适配器契约                  | 已实现；已观察搜索成功与直答拒答/超时，直答结构化成功样本待验收 |
| GEN-001 | 生成任务阶段 → 外部错误重试              | ADR-0004 的每个外部阶段对 `rate_limited`、`temporarily_unavailable`、`timeout` 最多重试 2 次；适配器不自行重试                                                                                                                                                                                                      | `invalid_request`、`authentication_failed`、`quota_exhausted`、`protocol_error` 不自动重试；第三方正文不跨边界                                                                                   | 地图生成模块 | 2026-09-02 | 生成策略或供应方错误契约变更                                  | 已接受                                                          |

## 外部适配边界

`src/modules/external-providers/public/contracts.ts` 定义稳定 DTO、`ExternalProviderError` 和版本常量；`public/server.ts` 只公开 `readExternalProviderEnvironment` 与 `createExternalProviderRuntime`。知乎原始字段、响应解析和 Bearer 凭据均限制在 `infrastructure`，地图生成只能依赖 `SourceSearchAccess` 与 `StructuredModelAccess`。

规范化来源包含：`sourceId`、`title`、`excerpt`、HTTPS 知乎 `url`、`authorName`、封闭 `contentType`、Unix 秒 `updatedAt`、封闭 `authorityLevel` 和 `rankingScore`。来源 URL 由适配器提供，模型不得输出 URL；适配器只做结构校验和标准 URL 序列化，保留查询及 `utm_*` 溯源参数，不决定业务 canonical。`sourceId` 由官方 `ContentType` 与 `ContentID` 组合派生，生成聚合按 `sourceId` 去重；更深层规范身份及同内容跨 ID 去重仍待决策。

HTTP 与业务错误码采用双层映射：明确的 HTTP 401/403、402、408、429 和 5xx 先映射鉴权、配额、超时、限流和暂时不可用；合法供应方业务码 `10001/20001/30001/30002/90001` 分别映射参数、鉴权、限流、配额和暂时不可用。可解析的 `Retry-After` 只输出为 `retryAfterMs`，响应正文不会进入错误。

## 采样和事实边界

仓库内 fixture 明确标注为官方 Skill 0.2.1/2026-07-16 文档样本，不是本项目在线采样。2026-09-02 已取得一次无密钥脱敏探针：搜索请求未发送 Authorization/Timestamp 时收到 HTTP 200、`Code=20001`；直答合法请求未发送 Authorization/Timestamp 时收到 HTTP 401、`invalid_api_key`。动态响应头、Cookie、request-id 和凭据均未保存。

当前没有本项目 Access Secret，因此成功搜索/空结果、限流、配额和直答成功的真实在线响应仍未取得。契约测试验证脱敏 fixtures、严格解析和错误转换，但不能替代在线采样。上线前须在受控服务端环境补采并复核；不得把文档样本或无密钥失败探针宣称为在线成功验收。
开放平台文档当前记载邀测免费额度为知乎搜索 5,000 次/日、知乎直答 100 次/日；同账号的 Secret 与页面/API 请求共享额度池，规则可能变化，最终以个人中心用量统计为准。这不是知径 SLA，适配器和生成任务不硬编码本地额度，也不提供虚假的额度剩余或静默额度兜底。

## 其他兼容边界

- 知乎 OAuth 与 Better Auth Session 不兼容且不互相替代；一期不实现知乎 OAuth 登录；
- 用户数据 API 和 MCP 文本不是一期来源输入，不得绕过 `SourceSearchAccess`；
- SSE、数据库和生成状态机的兼容登记由对应地图生成/HTTP 代理模块维护，本文件只登记它们与外部错误端口的交界。
