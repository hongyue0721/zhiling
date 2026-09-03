# 学习关系列表与地图读取契约

## 已发布接口

### 读取本人学习关系列表

`GET /api/learning-relationships`

接口返回当前正式账户拥有的学习关系摘要，用于跨会话、跨设备恢复。服务端按关系创建顺序及关系 ID 提供稳定顺序；响应只包含本人关系，不返回其他账户的关系。

### 读取关系绑定地图

`GET /api/learning-relationships/{learningRelationshipId}/map`

接口读取当前正式账户的一条学习关系，并返回该关系固定绑定的不可变已发布地图版本。学习关系由精选加入、生成成功或缓存命中流程建立；本接口只读，不提供凭地图 ID 加入、自助领取或分享入口。

完成答题后读取结课汇总见[私人结课报告 API](learning-report.md)；该接口继续使用同一 `learningRelationshipId`，不会创建分享或跨账户读取入口。

## 读取本人学习关系列表

### 请求

```http
GET /api/learning-relationships
Accept: application/json
Cookie: <Better Auth Session>
```

浏览器请求应设置 `credentials: "include"`，不传请求体、`userId`、`mapId`、`versionId` 或 `questionSetId`。

### 成功响应

状态码 `200`，响应只包含当前账户可恢复所需的公开摘要：

```json
{
  "items": [
    {
      "learningRelationshipId": "learning_01JXEXAMPLE",
      "mapId": "map_distributed_systems",
      "versionId": "version_20260902_01",
      "title": "分布式系统入门",
      "summary": "从一致性、复制到故障恢复"
    }
  ]
}
```

示例内容仅用于说明公开字段形状，不是仓库种子数据或运行时回退值。

`items` 按服务端稳定顺序返回。每项只含 `learningRelationshipId`、`mapId`、`versionId`、`title`、`summary`；不含 `userId`、`questionSetId`、内部时间或其他数据库字段。空目录是合法成功状态：`{ "items": [] }`。

### 列表失败响应

- `401 authentication_required`：Session 缺失、失效或账户尚未形成正式身份；
- `500 internal_error`：服务端无法完成列表投影。

列表成功与错误响应均为 `Cache-Control: private, no-store`。

## 地图请求

- 使用 Better Auth Session Cookie，浏览器请求设置 `credentials: "include"`；
- `learningRelationshipId` 来自精选加入、生成成功、缓存命中或本人关系列表；

## 地图成功响应

状态码 `200`，响应字段与[精选地图详情](featured-learning-maps.md#精选地图详情)的完整地图投影一致：

- `mapId`：稳定主题身份；
- `versionId`：该学习关系固定绑定的不可变版本；
- `title`、`summary`；
- `nodes`、`prerequisites`、`sources`、`viewpoints`。

```json
{
  "mapId": "map_distributed_systems",
  "versionId": "version_20260902_01",
  "title": "分布式系统入门",
  "summary": "从一致性、复制到故障恢复",
  "nodes": [],
  "prerequisites": [],
  "sources": [],
  "viewpoints": []
}
```

正式地图实际包含 5 至 7 个节点；示例省略内容仅为缩短文档，机器契约以 [`api/openapi.yaml`](../../api/openapi.yaml) 为准。

## 地图失败响应

- `401 authentication_required`：Session 缺失、失效或账户尚未形成正式身份；
- `404 resource_not_found`：学习关系不存在、不属于当前账户，或其版本尚未发布；
- `500 internal_error`：服务端无法完成请求。

成功与错误响应均为 `Cache-Control: private, no-store`。

## 前端处理

1. 应用进入学习区时先读取 `GET /api/learning-relationships`，把摘要渲染为当前账户的可恢复入口；
2. 精选页加入成功后保存服务端返回的 `learningRelationshipId`，用它进入地图页；
3. 地图页始终通过 `GET /api/learning-relationships/{learningRelationshipId}/map` 恢复完整地图，不根据 `mapId` 猜测自定义地图入口；
4. `404` 统一返回地图不可用页面，不继续探测其他账户或其他版本；
5. `versionId` 变化时替换整份地图投影，不合并旧节点和来源。
