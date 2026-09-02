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

| Issue | 决策 | 阻塞工作包 |
| --- | --- | --- |
| [#4](https://github.com/hongyue0721/zhiling/issues/4) | 认证会话与邮箱能力范围 | C1 |
| [#2](https://github.com/hongyue0721/zhiling/issues/2) | 地图生成运行与 SSE 恢复 | D1、F |
| [#3](https://github.com/hongyue0721/zhiling/issues/3) | 学习验证计分与完成规则 | D2、E2、F |
| [#5](https://github.com/hongyue0721/zhiling/issues/5) | 生成任务与自定义地图授权 | C2、D1、F |
| [#1](https://github.com/hongyue0721/zhiling/issues/1) | 登录后分享接收者规则 | E2、F |

## 外部契约准备

| Issue | 任务 | 状态 | 下游 |
| --- | --- | --- | --- |
| [#6](https://github.com/hongyue0721/zhiling/issues/6) | 获取并冻结知乎与模型 API 真实契约 | 可领取 | C3、D1 |

## 工作包队列

| 工作包 | Issue | 当前状态 | 主要前置 |
| --- | --- | --- | --- |
| B 工程基础 | [#7](https://github.com/hongyue0721/zhiling/issues/7) | 已实现，待合入 | ADR-0008、ADR-0009 已接受 |
| C1 身份与会话 | [#8](https://github.com/hongyue0721/zhiling/issues/8) | 已实现，待合入 | B、ADR-0010 已完成 |
| C2 学习目录与来源 | [#10](https://github.com/hongyue0721/zhiling/issues/10) | 阻塞 | #7；授权部分依赖 #5 |
| C3 外部适配器 | [#9](https://github.com/hongyue0721/zhiling/issues/9) | 阻塞 | #6、#7 |
| D1 地图生成 | [#12](https://github.com/hongyue0721/zhiling/issues/12) | 阻塞 | #2、#5、#8、#9、#10 |
| D2 验证与进度 | [#11](https://github.com/hongyue0721/zhiling/issues/11) | 阻塞 | #3、#8、#10 |
| E1 匿名数据合并 | 无 | 已取消 | ADR-0005 Rejected、ADR-0007 Accepted；编号不复用 |
| E2 报告与分享 | [#13](https://github.com/hongyue0721/zhiling/issues/13) | 阻塞 | #1、#8、#11 |
| F 用户闭环 | [#14](https://github.com/hongyue0721/zhiling/issues/14) | 阻塞 | #8 至 #13 中所有相关工作包与决策 |

## 领取规则

开始任务前，仓库维护者必须在对应 Issue 中填写负责人、独立评审者、允许修改范围和目标分支。若任务状态与依赖证据不一致，以真实依赖为准，先修正 Issue 和本表，不能为了开工删除阻塞说明。

本队列反映仓库内实现状态；GitHub Issue 的关闭与合入仍由维护者按领取和评审规则执行。
