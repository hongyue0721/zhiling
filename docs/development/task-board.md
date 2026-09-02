# 协作任务队列

> 状态：协作基线。GitHub Issue 是任务实时状态源；本文件记录工作包、决策与依赖关系，任务结构变化时同步更新。

## 状态流转

一个 Issue 同一时刻只保留一个 `状态：` 标签：

```text
待决策 ──→ 决策完成并关闭
待分配 ──→ 阻塞 / 可领取
阻塞 ──→ 可领取
可领取 ──→ 进行中
进行中 ──→ 评审中
评审中 ──→ 进行中 / 合入并关闭
```

- `待分配` 是新表单进入后的分诊状态，不表示已经可以实现；
- `阻塞` 必须在 Issue 正文列出明确前置和解除证据；
- `可领取` 表示前置契约已满足，但仍需在 Issue 指定作者与评审者；
- 关闭 Issue 必须关联已合入 PR 或明确的决策记录，不能只改标签制造完成状态。

## 待决策队列

当前没有阻塞已登记工作包的产品或架构决策。供应商真实契约、精选审核职责、数据保留等事实仍按对应 Issue 或工作包确认，不能由实现猜测。

## 已完成决策

| 来源 | 决策结果 | 落地证据 |
| --- | --- | --- |
| [#4](https://github.com/hongyue0721/zhiling/issues/4) | 强制邮箱验证、数据库 Session、Resend 发信、一期不提供密码恢复 | ADR-0010、工作包 C1 |
| C2 地图版本评审 | 稳定地图身份、不可变版本、精选指针、既有学习关系绑定原版本 | ADR-0011、工作包 C2a |
| [#1](https://github.com/hongyue0721/zhiling/issues/1) | 一期不实现分享，结课报告仅所属账户可读 | ADR-0012 |
| [#2](https://github.com/hongyue0721/zhiling/issues/2) | 自管 VPS Docker、数据库租约 Worker、可恢复 SSE 与原子发布 | ADR-0004 |
| [#3](https://github.com/hongyue0721/zhiling/issues/3) | 等权计分、80% 完成、无限重试、不可变版本成绩 | ADR-0013 |
| [#5](https://github.com/hongyue0721/zhiling/issues/5) | 参与者任务授权、缓存复用、私有自定义地图 | ADR-0014 |

## 外部契约准备

| Issue | 任务 | 状态 | 下游 |
| --- | --- | --- | --- |
| [#6](https://github.com/hongyue0721/zhiling/issues/6) | 获取并冻结知乎与模型 API 真实契约 | 可领取 | C3、D1 |

## 工作包队列

| 工作包 | Issue | 当前状态 | 主要前置 |
| --- | --- | --- | --- |
| B 工程基础 | [#7](https://github.com/hongyue0721/zhiling/issues/7) | 已提交 `main` | ADR-0008、ADR-0009 已接受 |
| C1 身份与会话 | [#8](https://github.com/hongyue0721/zhiling/issues/8) | 已提交 `main` | B、ADR-0010 已完成 |
| C2 学习目录与来源 | [#10](https://github.com/hongyue0721/zhiling/issues/10) | 精选读取已实现；自定义读取可领取 | B、ADR-0002、ADR-0011、ADR-0014 |
| C3 外部适配器 | [#9](https://github.com/hongyue0721/zhiling/issues/9) | 阻塞 | #6 |
| D1 地图生成 | [#12](https://github.com/hongyue0721/zhiling/issues/12) | 阻塞 | #6、#9、#10 |
| D2 验证与进度 | [#11](https://github.com/hongyue0721/zhiling/issues/11) | 阻塞 | #10 |
| E1 匿名数据合并 | 无 | 已取消 | ADR-0005 Rejected、ADR-0007 Accepted；编号不复用 |
| E2 结课报告 | [#13](https://github.com/hongyue0721/zhiling/issues/13) | 阻塞 | #11；分享已由 ADR-0012 移出一期 |
| F 用户闭环 | [#14](https://github.com/hongyue0721/zhiling/issues/14) | 阻塞 | #9 至 #13 中仍未完成的相关工作包 |

## 领取规则

开始任务前，仓库维护者必须在对应 Issue 中填写负责人、独立评审者、允许修改范围和目标分支。若任务状态与依赖证据不一致，以真实依赖为准，先修正 Issue 和本表，不能为了开工删除阻塞说明。

本队列反映仓库内实现状态；GitHub Issue 的关闭与合入仍由维护者按领取和评审规则执行。
