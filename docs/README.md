# 项目文档索引

文档与代码具有同等交付地位。产品事实、架构决策、接口契约和实现必须保持一致；发生冲突时，不应自行选择方便实现的一方，而应先修正文档或决策。

## 事实层级

1. [`PROJECT_GOAL.md`](../PROJECT_GOAL.md)：产品定位、一期范围、技术方向和成功标准；
2. [`architecture/decisions/`](architecture/decisions/)：已经接受的架构决策；
3. [`api/openapi.yaml`](../api/openapi.yaml)：已经发布的 HTTP API 机器契约；
4. 其他设计文档：对上述事实的拆解和实现指导。

标记为“提议”的文档或 ADR 不能被当作已确认业务事实。实现若依赖其中尚未决定的内容，必须先完成评审。

## 阅读路径

- 产品与范围：[产品需求索引](product/requirements.md)
- 系统边界：[系统上下文](architecture/system-context.md)
- 模块关系：[模块边界](architecture/boundaries.md)
- 工程结构：[工程目录与依赖方向](architecture/project-structure.md)
- 领域规则：[领域契约](architecture/domain-contracts.md)
- 生成闭环：[地图生成流程](architecture/generation-pipeline.md)
- 数据关系：[数据模型](architecture/data-model.md)
- 外部隔离：[兼容性策略](architecture/compatibility.md)
- 安全规则：[安全边界](architecture/security-boundaries.md)
- 权限规则：[访问控制矩阵](architecture/access-control.md)
- API 维护：[API 文档](api/README.md)
- 分工顺序：[工作包](development/work-packages.md)
- 任务队列：[协作任务队列](development/task-board.md)
- 就绪审计：[协作就绪清单](development/collaboration-readiness.md)
- 并行交接：[并行工作与交接协议](development/parallel-work.md)
- 文档维护：[文档治理规则](development/documentation-policy.md)
- 所有权分配：[所有权与评审分配](development/ownership.md)
- 合入门禁：[变更评审指南](development/review-guidelines.md)
- 仓库治理：[GitHub 仓库治理设置](development/repository-settings.md)
- 决策记录：[ADR 索引](architecture/decisions/README.md)

## 同步更新规则

| 变更类型 | 必须同步检查 |
| --- | --- |
| 产品范围或业务规则 | `PROJECT_GOAL.md`、产品需求、领域契约、验收测试 |
| 模块职责或依赖方向 | 架构总览、模块边界、相关 ADR |
| HTTP/SSE 接口 | OpenAPI、API 说明、示例、契约测试、兼容登记 |
| 数据模型或事务边界 | 数据模型、ADR、迁移说明、集成测试 |
| 第三方协议或版本 | 适配器契约、兼容登记、契约样本与测试 |
| 用户可见行为 | CHANGELOG、产品文档和验收场景 |
