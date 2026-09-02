# API 文档

API 采用契约优先。机器可读的单一事实源是 [`api/openapi.yaml`](../../api/openapi.yaml)，本文档只描述维护流程。

新增或修改 API 时必须同步提供：

- 请求、响应和错误 schema；
- 成功、边界和失败示例；
- 身份认证与权限要求；
- 幂等、分页、并发及限流语义（适用时）；
- 兼容性影响、废弃标记和迁移说明；
- 契约与实现测试。

当前未确认任何知径业务接口，因此 OpenAPI 文件不包含虚构路径。外部供应方协议不写入知径 OpenAPI，知乎接口单独记录在[知乎开放平台外部契约](zhihu-open-platform.md)。

首版业务接口实现前还需评审 [API 约定](conventions.md)，尤其是统一错误模型、身份上下文和 SSE 恢复语义。

业务 HTTP 错误遵循 [统一错误模型](error-model.md)。Better Auth `1.7.2` 托管端点、正式身份、Session 与邮件投递语义记录在[认证框架契约](authentication.md)，不写入知径业务 OpenAPI。
