# 学习验证与进度 API

D2 将题目、判题和节点进度绑定在 `learningRelationshipId` 上。地图题目集发布后，关系的首次建立或再次恢复会固定该地图版本对应的已发布题目集；精选指针或后续地图版本变化不会重算既有答题事实。

## 获取节点题面

`GET /api/learning-relationships/{learningRelationshipId}/nodes/{nodeId}/assessment`

请求必须携带当前正式账户的 Better Auth Session Cookie。服务端先通过 `learningCatalog.findByLearningRelationship(userId, learningRelationshipId)` 解析关系归属和固定地图版本，再读取该版本题目集和节点。

成功响应 `200` 的字段包括：

- `learningRelationshipId`、`versionId`、`questionSetId` 和 `nodeId`；
- 该节点 2–3 道题的 `questionId`、题型、题干、选项和来源 ID。

题面 DTO **不包含**正确选项、匹配标准答案、评分规则或解释。题目类型是 `single_choice`、`multiple_choice`、`matching`、`opinion_analysis`。

关系不存在、不属于当前账户、版本未发布或没有已发布题目集时统一返回 `404 resource_not_found`，不暴露其他账户资源是否存在。

## 提交答案

`POST /api/learning-relationships/{learningRelationshipId}/nodes/{nodeId}/assessment`

必须携带：

- 当前正式账户 Session Cookie；
- `Idempotency-Key` 请求头（1–256 个字符）；
- JSON 请求体：

```json
{
  "answers": [
    { "questionId": "q_single", "selectedOptionIds": ["option_a"] },
    {
      "questionId": "q_matching",
      "matches": [{ "leftOptionId": "left_a", "rightOptionId": "right_b" }]
    }
  ]
}
```

单选、多选和观点辨析使用 `selectedOptionIds`；匹配题使用 `matches`。客户端不提交用户 ID、地图 ID、版本 ID 或题目集 ID，作用域均从学习关系解析。

服务端在单个事务中完成：读取固定版本题目和答案、判题、写入不可变尝试、原子更新节点最佳成绩与首次完成事实。结果包含每道题的 `correct`、整数基点分数、服务端解释和来源 ID，以及 `nodeScore`、`bestScore`、`completed`。

判分规则：

- 单选、匹配、观点辨析完全正确为 `10000`，否则为 `0`；
- 多选为 `max(0, (选中正确项数 - 选中错误项数) / 正确项总数)`，转换为 0–10000 基点并向下取整；
- 节点分数是题目基点算术平均并向下取整；最佳分数达到 `8000`（80%）时完成。

同一 `learningRelationshipId`、题目集和 `Idempotency-Key` 再次提交返回首次提交的完全相同结果，不产生第二次尝试。不同键不限重试；最佳分数只取最大值，完成状态一旦成立不能回退。

失败响应：

- `400 invalid_request`：缺少幂等键或请求体不符合题型结构；
- `401 authentication_required`：没有有效正式身份；
- `404 resource_not_found`：关系、节点或固定题目集不可用；
- `500 internal_error`：服务端无法完成事务。

所有响应均为 `Cache-Control: private, no-store`。

## 读取进度和历史摘要

`GET /api/learning-relationships/{learningRelationshipId}/progress`

成功响应 `200`：

```json
{
  "learningRelationshipId": "learning_example",
  "versionId": "version_20260902_01",
  "questionSetId": "assessment_version_01",
  "nodes": [
    {
      "nodeId": "node_1",
      "bestScore": 8000,
      "completed": true,
      "completedAt": "2026-09-02T08:00:00.000Z",
      "bestAttemptId": "attempt_example"
    }
  ],
  "attempts": [
    {
      "attemptId": "attempt_example",
      "nodeId": "node_1",
      "nodeScore": 8000,
      "submittedAt": "2026-09-02T08:00:00.000Z"
    }
  ]
}
```

`nodes` 按关系地图的节点顺序返回，未作答节点的最佳分数为 `0`、`completed` 为 `false`。`attempts` 是不可变尝试摘要，按最新提交时间倒序；不返回用户提交答案或服务端标准答案。错误账户和不存在关系统一 `404 resource_not_found`。

机器可读字段和错误响应以 [`api/openapi.yaml`](../../api/openapi.yaml) 为准。
