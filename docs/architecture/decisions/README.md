# 架构决策记录（ADR）

影响多个模块、长期维护成本或公共契约的决定必须创建 ADR。

文件命名：`NNNN-short-title.md`。状态可为 `Proposed`、`Accepted`、`Rejected`、`Deprecated` 或 `Superseded`。

每份 ADR 至少包含：背景、决策、理由、替代方案、正反影响、迁移与验证方式。首个决策请复制 [模板](0000-template.md)，不要直接修改模板。

## 决策清单

| 编号 | 决策 | 状态 |
| --- | --- | --- |
| [0001](0001-nextjs-modular-monolith.md) | 采用 Next.js 全栈模块化单体 | Accepted |
| [0002](0002-source-evidence-is-a-domain-invariant.md) | 将来源证据作为领域不变量 | Accepted |
| [0003](0003-isolate-external-providers-with-adapters.md) | 使用适配器隔离外部供应商协议 | Accepted |
| [0004](0004-generation-state-machine-and-atomic-publication.md) | 地图生成状态机与原子发布 | Accepted |
| [0005](0005-transactional-anonymous-account-merge.md) | 匿名账户事务性合并方案 | Rejected |
| [0006](0006-contract-first-api-and-compatibility.md) | API 契约优先并显式管理兼容性 | Accepted |
| [0007](0007-require-login-for-all-product-capabilities.md) | 所有产品能力必须登录 | Accepted |
| [0008](0008-project-structure-and-dependency-direction.md) | 固定工程目录与依赖方向 | Accepted |
| [0009](0009-unified-business-api-error-contract.md) | 统一业务 API 错误契约 | Accepted |
| [0010](0010-email-verification-and-session-policy.md) | 邮箱验证与会话安全策略 | Accepted |
| [0011](0011-immutable-map-versions-and-featured-pointer.md) | 不可变地图版本与精选指针 | Accepted |
| [0012](0012-no-sharing-in-first-phase.md) | 一期不实现分享能力 | Accepted |
| [0013](0013-assessment-scoring-and-completion.md) | 学习验证计分与完成规则 | Accepted |
| [0014](0014-generation-participants-and-private-custom-maps.md) | 生成参与者与私有自定义地图授权 | Accepted |

状态流转规则：

- `Proposed`：设计已经形成但仍需人类确认；
- `Accepted`：已接受并成为实现约束；
- `Rejected`：提议从未被采纳，保留记录且不得实现；
- `Deprecated`：曾经接受，现已进入弃用或迁移阶段；
- `Superseded`：曾经接受，现已被另一份明确链接的 ADR 替代。

通常只有 `Proposed → Accepted/Rejected` 和 `Accepted → Deprecated/Superseded` 两类流转。未接受的决策不能作为擅自补齐业务规则的依据。
