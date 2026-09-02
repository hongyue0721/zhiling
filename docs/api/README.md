# API 文档

API 采用契约优先。机器可读的单一事实源是 [`api/openapi.yaml`](../../api/openapi.yaml)，本文档只描述维护流程。

新增或修改 API 时必须同步提供：

- 请求、响应和错误 schema；
- 成功、边界和失败示例；
- 身份认证与权限要求；
- 幂等、分页、并发及限流语义（适用时）；
- 兼容性影响、废弃标记和迁移说明；
- 契约与实现测试。

当前已发布的知径业务接口包括需要正式 Session 的精选学习地图目录、精选详情，以及按账户学习关系读取的不可变地图版本。前端接入见[精选学习地图契约](featured-learning-maps.md)和[学习关系地图读取契约](learning-relationships.md)。外部供应方协议不写入知径 OpenAPI，知乎接口单独记录在[知乎开放平台外部契约](zhihu-open-platform.md)。

后续接口仍须遵循 [API 约定](conventions.md)，尤其是统一错误模型、身份上下文和 SSE 恢复语义；未确认的接口不得提前写入 OpenAPI。

业务 HTTP 错误遵循 [统一错误模型](error-model.md)。Better Auth `1.7.2` 托管端点、正式身份、Session 与邮件投递语义记录在[认证框架契约](authentication.md)，不写入知径业务 OpenAPI。
