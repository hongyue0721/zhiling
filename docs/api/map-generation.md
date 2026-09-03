# 自定义学习地图生成接口

机器可读契约以 [`api/openapi.yaml`](../../api/openapi.yaml) 为准。本页只记录已经落地的传输行为；地图状态、缓存身份、参与关系和发布事务由地图生成模块公开入口负责。

## 身份与隐私

三个接口都要求 Better Auth 的正式 Session。身份只从 Session 读取，客户端不能提交 `userId`。任务参与关系由生成模块在创建或复用的事务中建立：

- 未登录请求返回 `401 authentication_required`；
- 已登录但不是任务参与者的账户返回 `404 resource_not_found`，不泄露任务是否存在；
- 缓存命中仍为当前账户建立自己的学习关系，不凭地图 ID 授权；
- 响应和 SSE 不包含候选节点、题目、知乎来源正文或第三方错误正文。

Web 进程只读写任务的持久化状态，不读取知乎 Access Secret。真实供应方配置由独立 Worker 在启动时校验。

## 请求任务

`POST /api/map-generations`

请求体严格为 JSON 对象 `{ "topic": string }`。主题会在 HTTP 边界执行非空、最多 200 个字符校验，未知字段和无效 JSON 返回统一错误信封；根级错误使用 JSON Pointer 空字符串 `""`：

```json
{
  "error": {
    "code": "invalid_request",
    "message": "请求内容不符合接口要求",
    "requestId": "req_01JXEXAMPLE",
    "issues": [
      {
        "path": "/topic",
        "code": "too_small",
        "message": "请输入学习主题"
      }
    ]
  }
}
```

成功统一返回 `202`，`reuse` 表示任务是新建、加入活动任务还是命中缓存：

相同规范化主题、管线版本、来源适配器版本和模型适配器版本只复用六小时内的成功缓存；缓存过期后创建新任务和不可变版本，但沿用该主题的稳定 `mapId`。新任务成功发布时按这组身份原子替换缓存记录并刷新缓存时间，后续六小时内的请求只复用最新成功任务。

```json
{
  "reuse": "created",
  "snapshot": {
    "taskId": "task_01JXEXAMPLE",
    "status": "queued",
    "stage": "queued",
    "sequence": 1,
    "createdAt": "2026-09-02T10:00:00.000Z",
    "updatedAt": "2026-09-02T10:00:00.000Z",
    "deadlineAt": "2026-09-02T10:10:00.000Z",
    "result": null,
    "completedAt": null,
    "failure": null
  }
}
```

请求级错误只覆盖同步入口：`400 invalid_request`/`invalid_topic`、`401 authentication_required`、`429 rate_limited` 和未预期的 `500 internal_error`。限流按当前账户计数，只有成功持久化新生成任务的请求消耗配额；加入活动任务或命中缓存的幂等重试不重复计数。`Retry-After` 以秒返回窗口剩余时间。来源、模型、材料、候选与总时限失败由异步任务的 `failure` 和 SSE 终态报告。

## 查询快照

`GET /api/map-generations/{taskId}`

成功返回 `200` 和 `GenerationTaskSnapshot`。`status` 是封闭集合：

`queued`、`normalizing`、`cache_lookup`、`planning`、`searching`、`structuring`、`supplementing`、`extracting`、`assessing`、`validating`、`publishing`、`succeeded`、`failed`。

终态成功时 `result` 只包含 `mapId`、`versionId` 和当前账户的 `learningRelationshipId`；终态失败时 `failure` 只包含失败分类和 `retryable`：

`completedAt` 在任务终止前为 `null`，成功或失败后为终止时间。

`invalid_topic`、`source_unavailable`、`source_insufficient`、`model_unavailable`、`candidate_invalid`、`generation_timeout`、`internal_failure`。

快照读取不返回候选正文。任务不存在、过期或当前账户未参与时都使用相同的 `404 resource_not_found`。

## SSE 进度与恢复

`GET /api/map-generations/{taskId}/events`

响应为 `text/event-stream`，并设置：

- `Cache-Control: private, no-cache, no-transform`；
- `X-Accel-Buffering: no`，避免 Nginx 等反向代理缓存事件；
- 任务到达 `succeeded` 或 `failed` 后发送终态事件并关闭连接。

客户端重连时发送 `Last-Event-ID: <sequence>`。服务端把它解析为非负整数并传给公开的 `readEvents` 入口，不接受客户端提供的用户 ID。保留的历史可用时只重放序号更大的事件；历史不可用时，先发送当前完整、按当前账户授权的 `snapshot`，再发送可用的新事件。晚于当前任务序列的游标返回 `400 out_of_range`，不会建立无限等待的流；游标恰好等于 `succeeded` 或 `failed` 任务的最终序列时，返回当前账户安全的终态 `snapshot` 并立即关闭连接；非终态任务的相同游标继续等待后续事件。
每条事件严格使用以下封闭格式，`id` 与 JSON 中的 `sequence` 相同且在任务内单调递增：

```text
id: 7
event: progress
data: {"protocolVersion":"1","taskId":"task_01JXEXAMPLE","sequence":7,"type":"progress","occurredAt":"2026-09-02T10:01:00.000Z","data":{"status":"searching","stage":"searching"}}

```

`event` 只能是 `snapshot`、`progress`、`succeeded` 或 `failed`。JSON 信封中的 `data` 只允许安全状态、阶段、序号、时间、正式结果标识和稳定失败类别。`succeeded`/`failed` 是 task-wide 终态事件，不携带 participant-specific `learningRelationshipId`；客户端收到后必须用当前账户授权的 `GET /api/map-generations/{taskId}` 快照读取 `result` 或 `failure`，再导航或展示失败。失败的 `retryable` 必须来自该授权快照，未知时不得推断。非终态连接每 15 秒发送 `: keep-alive` 注释；客户端取消请求后服务端停止轮询并释放流。

未登录或错误账户在建立初次连接和每次重连时都重新验证，统一返回 `401` 或不暴露存在性的 `404`，而不是建立匿名流。
