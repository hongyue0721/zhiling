# 架构总览

> 状态：模块化单体、工程边界、身份后端、学习目录、外部适配、地图生成、学习验证、学习进度与私人结课报告已实现；其余领域和上线决策继续按 ADR 推进。产品边界以 `PROJECT_GOAL.md` 为准。

## 设计目标

- 业务规则与传输、存储和第三方集成细节分离；
- 模块通过显式契约协作，不读取其他模块的内部状态；
- 失败语义可观察，禁止把事实缺失包装为成功；
- API、数据和外部集成都具有可测试的兼容边界。

## 技术边界

- Next.js 15 全栈单体、React、TypeScript 与 Tailwind CSS；
- 地图交互使用 `@xyflow/react`，客户端局部状态使用 Zustand；
- 边界数据使用 Zod 校验，自定义地图生成通过 SSE 报告阶段进度；
- PostgreSQL、Drizzle ORM 与 Drizzle migrations；
- Better Auth 与 Email & Password；
- 知乎 API 和模型 API 均置于独立适配器之后。

上述技术方向中，Next.js 15 工程边界、PostgreSQL/Drizzle、Better Auth、业务 SSE、知乎/模型适配器、同镜像 Web/Worker 运行方式及正式用户 UI（图交互、状态投影、答题和报告）已经落地；真实供应方成功样本、生产精选内容和 VPS 运维证据仍按 Issue #14 补齐。

## 逻辑分层

逻辑分层只约束职责和依赖方向，具体工程目录由后续目录 ADR 决定：

1. **接口层**：协议解析、身份上下文、输入校验和响应映射。
2. **应用层**：编排用例、事务边界和授权决策。
3. **领域层**：业务实体、值对象、规则及领域事件。
4. **基础设施层**：数据库、消息、缓存及第三方服务适配器。

依赖方向应指向业务核心。领域层不得依赖 Web 框架、数据库驱动或第三方 SDK。

## 已落地决策

- ADR-0008 固定目录与依赖方向，架构检查覆盖跨层、客户端服务端泄漏和循环依赖；
- ADR-0010 固定显式邮箱验证策略（默认启用、可明确关闭）、无密码恢复、数据库 Session、共享限流与 Resend HTTP 投递；
- ADR-0011 固定不可变地图版本与精选指针；
- ADR-0004 固定自管 VPS Docker、数据库租约 Worker、可恢复 SSE 与原子发布；
- ADR-0012 将分享能力移出一期，结课报告仅所属账户可读；
- ADR-0013 固定学习验证计分、完成、重试、并发和版本规则；
- ADR-0014 固定任务参与关系、跨账户缓存复用与私有自定义地图授权；
- `identity` 模块只公开服务端最小正式身份，认证托管端点见[认证框架契约](../api/authentication.md)；`external-providers` 隔离知乎搜索与知乎直答协议；`map-generation` 持久化状态、参与关系、事件、租约与候选门禁；`learning-assessment` 与 `learning-progress` 通过公开契约和学习目录关系读取能力完成 D2 闭环；`learning-report` 通过 `learning-catalog` 与 `learning-progress` 的公开服务端契约投影所属账户报告，不持有报告副本或分享授权。

## 仍待确认事项

- 使用生产 Access Secret 取得的成功、空结果、限流与配额响应样本及部署环境时延；
- 精选地图人工审核入口与责任；
- 来源去重、保留期限及第三方删除后的处理；
- VPS 运行区域、日志保留、备份恢复和生产回滚门禁。

重要决策使用 [ADR](decisions/README.md) 记录。

进一步阅读：[系统上下文](system-context.md)、[领域契约](domain-contracts.md)、[地图生成流程](generation-pipeline.md)、[安全边界](security-boundaries.md)和[访问控制矩阵](access-control.md)。
