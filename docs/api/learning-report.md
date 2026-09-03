# 私人结课报告 API

## 已发布接口

`GET /api/learning-relationships/{learningRelationshipId}/report`

接口读取当前正式账户所属学习关系的服务端结课报告。报告不创建独立快照；每次读取都根据关系绑定的不可变地图版本、固定题目集、节点进度和不可变答题尝试摘要生成。

## 请求与授权

- 使用 Better Auth Session Cookie，浏览器请求设置 `credentials: "include"`；
- `learningRelationshipId` 必须来自当前账户的学习关系，不接受请求体、查询参数或请求头中的 `userId`；
- 服务端先解析并验证正式身份，再同时按账户和关系 ID读取地图与进度事实；
- 关系不存在、属于其他账户、固定地图版本不可读或固定题目集不可用时，统一返回 `404 resource_not_found`，不暴露资源是否存在；
- 一期不提供报告分享快照、分享令牌、接收者授权、撤销或跨账户读取能力。

## 成功响应

状态码 `200`，响应只包含报告投影：

- `learningRelationshipId`：当前账户的学习关系标识；
- `map`：关系固定绑定的 `mapId`、不可变 `versionId` 和地图标题；精选指针切换不会改变既有报告版本；
- `questionSetId`：关系固定绑定的已发布题目集；
- `completion`：已完成节点数、总节点数，以及按 `0..10000` 表示的完成度基点；
- `weakNodes`：至少有一次不可变答题尝试但尚未完成的节点，包含当前最佳成绩和来源 ID；
- `encounteredViewpoints`：至少有一次不可变答题尝试的节点所关联的观点；
- `nextSteps`：所有前置节点均已完成的未完成节点。已作答节点排在未作答节点之前，分别以 `improve_score` 和 `start_node` 标记原因；
- `sources`：报告中上述节点或观点实际引用的来源元数据，按固定地图来源顺序返回。

```json
{
  "learningRelationshipId": "learning_example",
  "map": {
    "mapId": "map_distributed_systems",
    "versionId": "version_20260902_01",
    "title": "分布式系统入门"
  },
  "questionSetId": "assessment_version_01",
  "completion": {
    "completedNodeCount": 2,
    "totalNodeCount": 5,
    "completionBasisPoints": 4000
  },
  "weakNodes": [
    {
      "nodeId": "node_consensus",
      "title": "一致性",
      "bestScore": 6000,
      "sourceIds": ["source_consensus"]
    }
  ],
  "encounteredViewpoints": [
    {
      "viewpointId": "viewpoint_consensus",
      "nodeId": "node_consensus",
      "kind": "consensus",
      "statement": "多数实现会在一致性与可用性之间取舍",
      "conditions": null,
      "sourceIds": ["source_consensus"]
    }
  ],
  "nextSteps": [
    {
      "nodeId": "node_consensus",
      "title": "一致性",
      "learningObjective": "理解一致性模型的差异",
      "reason": "improve_score",
      "sourceIds": ["source_consensus"]
    },
    {
      "nodeId": "node_replication",
      "title": "复制",
      "learningObjective": "比较常见复制策略",
      "reason": "start_node",
      "sourceIds": ["source_replication"]
    }
  ],
  "sources": [
    {
      "sourceId": "source_consensus",
      "title": "一致性来源",
      "url": "https://www.zhihu.com/question/consensus",
      "authorName": "作者甲"
    },
    {
      "sourceId": "source_replication",
      "title": "复制来源",
      "url": "https://www.zhihu.com/question/replication",
      "authorName": "作者乙"
    }
  ]
}
```

响应不会返回用户资料、Session、答题答案、题目解释中的服务端判题细节、`attemptId` 或原始 `attempts` 数组。客户端不得根据成绩自行推导完成状态；以服务端返回的 `completedNodeCount`、`weakNodes` 和 `nextSteps` 为准。

## 派生规则

- 完成度使用已完成节点数除以固定地图节点总数，再转换为 `0..10000` 的整数基点；总节点数始终为正数；
- 薄弱节点由不可变尝试摘要中的节点集合与持久化完成状态共同确定。完成节点即使有历史尝试也不进入 `weakNodes`；
- 观点只按不可变尝试涉及的节点筛选，不按当前精选指针或客户端传入节点补充；
- 下一步只包含未完成且所有直接前置节点已完成的节点。无前置节点的未完成节点可直接开始；地图存储顺序决定同组内顺序；
- 地图版本、题目集、成绩、完成状态和尝试摘要都来自同一学习关系的固定版本事实。事实版本不一致时服务端拒绝生成报告，而不是拼接不同版本。

## 失败响应与缓存

- `401 authentication_required`：Session 缺失、失效或账户尚未形成正式身份；
- `404 resource_not_found`：关系不存在、不属于当前账户、版本不可读或题目集不可用；
- `500 internal_error`：服务端无法完成报告投影，响应不包含内部异常细节。

错误响应示例（`404`）：

```json
{
  "error": {
    "code": "resource_not_found",
    "message": "结课报告不存在",
    "requestId": "req_0123456789abcdef0123456789abcdef"
  }
}
```

未登录时只返回 `401 authentication_required`；错误账户与不存在关系使用同一 `404` 错误信封和字段形状。

成功与错误响应均为 `Cache-Control: private, no-store`。机器可读字段和错误响应以 [`api/openapi.yaml`](../../api/openapi.yaml) 为准。
