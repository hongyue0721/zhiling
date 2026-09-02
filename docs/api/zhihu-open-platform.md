# 知乎开放平台外部契约

> 状态：已登记供应方文档，待使用真实 Access Secret 采集脱敏响应样本。本文记录外部供应方协议，不定义知径自己的 HTTP API。

## 资料来源与优先级

本契约依据哥哥提供的知乎黑客松资料包整理。包内官方 `zhihu` Skill 已按项目范围原样安装到 [`.omp/skills/zhihu`](../../.omp/skills/zhihu/)：

- Skill：`zhihu`；
- Skill 版本：`0.2.1`；
- CLI 最低版本：`0.1.0`；
- 官方快照来源：<https://developer-cdn.zhihu.com/zhihu-cli/releases/stable/skill/zhihu-cli-skill.zip>；
- 资料包 ZIP SHA-256：`be08e10bbd8f7c554456599e1bdf9e4a4f9216a7624d0b29218e9e4dc1c2f9f3`；
- 公共 HTTP/MCP 文档核验日期：`2026-07-16`；
- 用户数据与 OAuth 文档整理日期：`2026-07-22`。

原始契约全文：

- [公共 HTTP API](../../.omp/skills/zhihu/references/http-api.md)
- [用户数据 API](../../.omp/skills/zhihu/references/user-api.md)
- [OAuth 应用集成](../../.omp/skills/zhihu/references/oauth.md)
- [MCP 服务](../../.omp/skills/zhihu/references/mcp.md)
- [CLI 使用文档](../../.omp/skills/zhihu/references/cli.md)
- [开放平台与额度](../../.omp/skills/zhihu/references/open-platform.md)

事实优先级为：知乎开放平台当前官方页面与真实响应 > 项目内官方 Skill 快照 > 本摘要。发生冲突时必须停止适配并更新契约，不能用兼容兜底掩盖差异。

当前资料包没有定义独立的“比赛接口”域名或第二套字段；黑客松 Skill 使用的仍是 `developer.zhihu.com` 与 `openapi.zhihu.com`。在取得另一套真实协议前，不创建平行的比赛接口适配器。

## 项目使用边界

- `.omp/skills/zhihu` 是 Oh My Pi 的项目级 Skill 目录，只在本仓库内生效，不安装到用户级或全局 Skill 目录。
- Skill/CLI 是开发调查工具，不是知径生产运行时依赖；生产适配器直接调用经确认的 HTTP API。
- Skill 清单只声明 macOS 与 Windows CLI 产物，没有 Linux CLI 产物。本项目当前 Linux 工作站只能把 Skill 作为契约资料使用，不能宣称 CLI 已在本机可执行。
- 知径账户仍使用 Better Auth。知乎 OAuth 与知径登录严格分离，不能把知乎 OAuth Token 当作知径 Session。
- Access Secret、OAuth `app_key` 和 OAuth access token 不进入仓库、浏览器、响应、日志、测试快照或 Agent 输出。

## 公共鉴权

除 OAuth 授权页和换 Token 接口外，开放平台 HTTP API 使用：

```http
Authorization: Bearer <access_secret>
X-Request-Timestamp: <Unix 秒级时间戳>
Content-Type: application/json
```

凭证职责：

| 凭证 | 代表对象 | 用途 |
| --- | --- | --- |
| Access Secret | 开放平台调用方 | 公共内容、直答和用户数据 API 的 Bearer 鉴权 |
| OAuth `app_id` | 第三方应用 | 发起知乎用户授权 |
| OAuth `app_key` | 第三方应用密钥 | 仅后端交换 OAuth access token |
| OAuth access token | 已授权知乎用户 | 用户数据 API 的 `X-OAuth-Token` |

Access Secret 与 OAuth `app_key` 不是同一凭证，禁止互相替代。

## 公共内容 HTTP API

### 接口总表

| 能力 | 方法与 URL | 输入 | 成功数据 |
| --- | --- | --- | --- |
| 全网搜索 | `GET https://developer.zhihu.com/api/v1/content/global_search` | `Query` 必填；`Count` 默认 10、最大 20；`Filter`、`SearchDB` 可选 | `Data.HasMore`、`Data.Items[]` |
| 知乎搜索 | `GET https://developer.zhihu.com/api/v1/content/zhihu_search` | `Query` 必填；`Count` 默认 10、最大 10 | `Data.HasMore`、`SearchHashId`、`Items[]`、可选 `EmptyReason` |
| 知乎热榜 | `GET https://developer.zhihu.com/api/v1/content/hot_list` | `Limit` 默认 30、最大 30 | `Data.Total`、`Data.Items[]` |
| 知乎直答 | `POST https://developer.zhihu.com/v1/chat/completions` | `model`、`messages` 必填；`stream` 默认 `false` | 非流式 JSON 或 SSE 数据块 |

### 全网搜索

`SearchDB`：

- `all`：全部索引库，默认；
- `realtime`：实时库；
- `static`：静态库。

`Filter` 支持：

- `host`：String，支持 `==`、`!=`；
- `publish_time`：Unix 秒级时间戳，支持 `==`、`!=`、`>`、`>=`、`<`、`<=`；
- 大写 `AND`、`OR`，其中 `AND` 优先；
- 括号控制优先级；
- `host=="zhihu.com"` 及其子域名不受支持，知乎站内内容必须使用 `zhihu_search`。

全网搜索 `Item`：

| 字段 | 类型 | 必返 | 语义 |
| --- | --- | ---: | --- |
| `Title` | String | 是 | 标题 |
| `ContentType` | String | 是 | 内容类型 |
| `ContentID` | String | 是 | 内容 Token |
| `ContentText` | String | 是 | 摘要，命中高亮可能含 `<em>` |
| `Url` | String | 是 | 带溯源 UTM 的链接 |
| `CommentCount`、`VoteUpCount` | Int32 | 是 | 评论数、赞同数 |
| `AuthorName`、`AuthorAvatar` | String | 是 | 作者信息；匿名名称可能为“知乎用户” |
| `AuthorBadge`、`AuthorBadgeText` | String | 是 | 作者认证信息 |
| `EditTime` | Int64 | 是 | 最后编辑时间，Unix 秒 |
| `CommentInfoList` | Array | 否 | 精选评论；元素字段为 `Content` |
| `AuthorityLevel` | String | 是 | `1` 低、`2` 中、`3` 高、`4` 超高 |

资料没有给出全网搜索专属错误码表，适配器不得从其他接口复制错误集合冒充事实。

### 知乎搜索

边界行为：

- `Query` 不能为空；
- `Count <= 0` 回退为 `10`；
- `Count > 10` 截断为 `10`；
- 当前 `HasMore` 固定为 `false`。

知乎搜索 `Item`：

| 字段 | 类型 | 必返 | 语义 |
| --- | --- | ---: | --- |
| `Title`、`ContentType`、`ContentID`、`ContentText`、`Url` | String | 是 | 标题、类型、标识、摘要和来源链接 |
| `CommentCount`、`VoteUpCount` | Int32 | 是 | 评论数、赞同数 |
| `AuthorName`、`AuthorAvatar`、`AuthorBadge`、`AuthorBadgeText` | String | 是 | 作者信息 |
| `EditTime` | Int32 | 是 | 发布时间或更新时间，Unix 秒 |
| `CommentInfoList` | Array | 否 | 精选评论 |
| `AuthorityLevel` | String | 是 | 权威等级；资料未在本接口重复枚举含义 |
| `RankingScore` | Float32 | 是 | 排序分数 |

错误码：`0` 成功、`10001` 参数错误、`20001` 鉴权失败、`30001` 频率限制、`90001` 内部错误。

### 知乎热榜

边界行为：`Limit <= 0` 或 `Limit > 30` 时回退为 `30`。当前只返回问题和文章。

热榜 `Item`：

| 字段 | 类型 | 必返 | 语义 |
| --- | --- | ---: | --- |
| `Title` | String | 是 | 标题 |
| `Url` | String | 是 | 知乎链接 |
| `ThumbnailUrl` | String | 是 | 无封面时为 `""` |
| `Summary` | String | 是 | 无摘要时为 `""` |

错误码：`0` 成功、`20001` 鉴权失败、`30001` 频率限制、`90001` 内部错误。

### 知乎直答

支持模型：

| 模型 | 语义 |
| --- | --- |
| `zhida-fast-1p5` | 快速回答 |
| `zhida-thinking-1p5` | 深度思考，可返回 `reasoning_content` |
| `zhida-agent` | 智能检索与回答 |

正式支持的请求字段仅有：

```json
{
  "model": "zhida-thinking-1p5",
  "messages": [{ "role": "user", "content": "问题" }],
  "stream": false
}
```

其他 OpenAI 风格字段不保证生效。非流式响应包含 `id`、`object`、`created`、`model` 和 `choices[]`；回答位于 `choices[].message.content`，推理文本可能位于 `reasoning_content`。

流式响应规则：

- Content-Type 为 `text/event-stream`；
- 每个事件为 `data: <JSON>`；
- 结束标记为 `data: [DONE]`；
- 服务端可能发送 `: keep-alive` 注释；
- HTTP 200 发送后仍可能在数据块中以 `finish_reason: "error"` 和 `error` 对象报告失败。

错误对象字段为 `message`、`type`、可选 `param` 和 `code`。不得把供应方错误正文直接透传给客户端。

## 用户数据 HTTP API

### 身份模式

所有用户数据接口均需 Access Secret。代表另一个已授权知乎用户时，额外发送：

```http
X-OAuth-Token: <oauth_access_token>
```

不传该 Header 时查询 Access Secret 所属账号的公开范围数据。知径一期没有确认使用用户数据接口；在业务范围获批前不得调用。

### 接口总表

| 能力 | 方法与路径 | Query | `Data` |
| --- | --- | --- | --- |
| 用户内容 | `GET /api/v1/user/contents` | `ContentType` 必填；`Offset`、`Limit`、`SortField`、`SortOrder` 可选 | `Items[]`、`Paging` |
| 用户关注 | `GET /api/v1/user/followees` | `Offset`、`Limit` 可选 | `Items[]`、`Paging` |
| 收藏夹列表 | `GET /api/v1/user/favlists` | `Limit` 可选 | `Items[]` |
| 收藏夹内容 | `GET /api/v1/user/favlist_contents` | `FavlistUrlToken` 必填；`Offset`、`Limit` 可选 | `Items[]`、`Paging` |
| 近期收藏 | `GET /api/v1/user/collections` | `Limit` 可选 | `Items[]`；无完整历史分页 |

基础域名均为 `https://developer.zhihu.com`。分页 `Limit` 默认 `20`、最大 `50`。`Paging.NextOffset` 在响应中是 String，但请求 `Offset` 是 Int64；调用方必须严格解析，失败时返回协议错误，不能截断或回退。

用户内容 `ContentType`：`all`、`answer`、`article`、`zvideo`、`pin`、`question`。`SortField` 为 `like_count` 或 `ts`，默认 `ts`；`SortOrder` 为 `asc` 或 `desc`，默认 `desc`。

公共对象：

- `ContentItem`：`ContentType`、`Url`、`CreatedAt`、`LikeCount`、`CommentCount`、`FavoriteCount`、`Title`、`Summary`；
- `FolloweeItem`：`Fullname`、`UrlToken`、`Url`、`AvatarUrl`、`Headline`、`Gender`、`FollowerCount`；
- 收藏夹记录：`UrlToken`、`Url`、`Title`、`Description`、`IsPublic`；
- 收藏内容：内容与收藏时间、互动计数、标题、摘要、所属收藏夹和可选作者；
- `Paging`：`IsEnd`、可选 `NextOffset`、`Totals`。

用户 API 公共错误码：`0` 成功、`10001` 参数错误、`20001` 鉴权失败、`30001` 频率限制、`30002` 配额限制、`90001` 内部错误。

## OAuth 应用接口

### 授权页

```http
GET https://openapi.zhihu.com/authorize?redirect_uri={encoded_uri}&app_id={app_id}&response_type=code
```

### Token 交换

```http
POST https://openapi.zhihu.com/access_token
Content-Type: application/x-www-form-urlencoded
```

表单字段：`app_id`、`app_key`、固定值 `grant_type=authorization_code`、与登记值一致的 `redirect_uri`、回调授权码 `code`。

成功响应目前记录为：

```json
{
  "access_token": "<secret>",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

### 已知协议缺口

该 OAuth 协议当前不能作为知径生产登录能力：

1. 2026-05-14 黑客松实测回调字段为 `authorization_code`，Token 表单字段仍为 `code`；
2. 实测回调没有返回 `state`，无法完成标准登录 CSRF 校验；
3. 没有 PKCE、scope、拒绝授权、回调错误参数的正式契约；
4. 没有 refresh token、Token 撤销、授权查询或解绑接口；
5. `/user` 没有正式 endpoint 和响应 schema；
6. `app_key` 是否允许直接作为表单字段、是否另有签名要求仍待平台确认。

因此这里只登记协议，不实现知乎 OAuth 登录，也不把它与 Better Auth 合并。

## MCP 接口

所有 MCP 服务使用 `Authorization: Bearer <access_secret>`。

| 工具 | 传输与端点 | 入参 |
| --- | --- | --- |
| `global_search` | MCP over SSE：`/api/mcp/global_search/v1/sse` 与 `/message` | `query` 必填；`count` 1-20；可选 `filter`、`search_db` |
| `hot_list` | MCP over SSE：`/api/mcp/hot_list/v1/sse` 与 `/message` | 可选 `limit` 1-30 |
| `zhihu_search` | MCP over SSE：`/api/mcp/zhihu_search/v1/sse` 与 `/message` | `query` 必填；`count` 1-10 |
| `zhida` | MCP Streamable HTTP：`POST /api/mcp/zhida/v1/stream` | `query`、`model` 必填；`member_id` 为可选预留字段 |

上述相对路径的基础域名为 `https://developer.zhihu.com`。SSE 服务先连接 `/sse`，由 `endpoint` 事件返回带 `sessionId` 的实际 Message URL；`initialize`、`tools/list`、`tools/call` 发送到该地址，工具结果通过已建立的 SSE 通道返回。直答 MCP 使用同一个 Streamable HTTP 端点完成初始化、列举与调用。

MCP 工具当前返回面向模型消费的文本，不提供知径领域所需的稳定结构化来源对象。生产来源适配优先使用 HTTP API，不以 MCP 文本替代可校验的字段契约。

## 当前邀测额度

资料包记录的共享试用额度，不视为永久 SLA：

| 能力 | 每日额度 |
| --- | ---: |
| 全网搜索 | 5,000 |
| 知乎搜索 | 5,000 |
| 知乎热榜 | 100 |
| 知乎直答 | 100 |

同一账号最多申请 20 个 Access Secret，但共享同一额度池。页面效果测试与 API 调用也共享额度。

## 适配器实施前仍需补齐

- 使用项目自己的 Access Secret 采集脱敏的成功、空结果、参数错误、鉴权失败、限流和配额失败样本；
- 确认响应 HTTP 状态码与业务 `Code` 的组合规则；
- 确认请求时间戳允许偏差和重放拒绝语义；
- 确认全网搜索错误码集合；
- 确认 `ContentType`、`AuthorityLevel` 等实际枚举及未知值处理；
- 确认直答超时、速率限制、上下文长度及模型版本生命周期；
- 决定知径是否将知乎直答作为模型供应商；未决策前只登记为候选；
- 取得真实样本前，工作包 C3 仍不得根据示例 JSON 实现生产适配器。
