# 学习关系地图读取契约

## 已发布接口

`GET /api/learning-relationships/{learningRelationshipId}/map`

接口读取当前正式账户的一条学习关系，并返回该关系固定绑定的不可变已发布地图版本。学习关系由后续生成成功或缓存命中流程建立；本接口只读，不提供凭地图 ID 加入、自助领取或分享入口。

完成答题后读取结课汇总见[私人结课报告 API](learning-report.md)；该接口继续使用同一 `learningRelationshipId`，不会创建分享或跨账户读取入口。

## 请求

- 使用 Better Auth Session Cookie，浏览器请求设置 `credentials: "include"`；
- `learningRelationshipId` 来自生成成功或缓存命中的业务响应；
- 不传 `userId`、`mapId` 或 `versionId`，账户身份只取自服务端 Session。

## 成功响应

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

## 失败响应

- `401 authentication_required`：Session 缺失、失效或账户尚未形成正式身份；
- `404 resource_not_found`：学习关系不存在、不属于当前账户，或其版本尚未发布；
- `500 internal_error`：服务端无法完成请求。

成功与错误响应均为 `Cache-Control: private, no-store`。

## 前端处理

1. 生成成功后保存服务端返回的 `learningRelationshipId`，用它进入地图页；
2. 地图页始终通过本接口恢复完整地图，不根据 `mapId` 猜测自定义地图入口；
3. `404` 统一返回地图不可用页面，不继续探测其他账户或其他版本；
4. `versionId` 变化时替换整份地图投影，不合并旧节点和来源。
