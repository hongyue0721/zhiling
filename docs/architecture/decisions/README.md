# 架构决策记录（ADR）

影响多个模块、长期维护成本或公共契约的决定必须创建 ADR。

文件命名：`NNNN-short-title.md`。状态可为 `Proposed`、`Accepted`、`Deprecated` 或 `Superseded`。

每份 ADR 至少包含：背景、决策、理由、替代方案、正反影响、迁移与验证方式。首个决策请复制 [模板](0000-template.md)，不要直接修改模板。

## 决策清单

| 编号 | 决策 | 状态 |
| --- | --- | --- |
| [0001](0001-nextjs-modular-monolith.md) | 采用 Next.js 全栈模块化单体 | Accepted |
| [0002](0002-source-evidence-is-a-domain-invariant.md) | 将来源证据作为领域不变量 | Accepted |
| [0003](0003-isolate-external-providers-with-adapters.md) | 使用适配器隔离外部供应商协议 | Accepted |
| [0004](0004-generation-state-machine-and-atomic-publication.md) | 地图生成状态机与原子发布 | Proposed |
| [0005](0005-transactional-anonymous-account-merge.md) | 匿名账户数据采用事务性幂等合并 | Proposed |
| [0006](0006-contract-first-api-and-compatibility.md) | API 契约优先并显式管理兼容性 | Accepted |

`Accepted` 表示已是实现约束；`Proposed` 表示设计已经形成但仍需人类确认，不能作为擅自补齐业务规则的依据。
