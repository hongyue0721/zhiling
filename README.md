# 知径（Zhijing）

知径是一款基于知乎真实内容构建学习路径的 Web 教育产品。它将分散的真实讨论组织成有先后关系、可追溯、可验证的学习地图。

> 把知乎上的真实讨论，走成一条学会的路。

完整产品事实以 [PROJECT_GOAL.md](PROJECT_GOAL.md) 为准。当前仓库处于设计与协作基线阶段，暂不创建应用代码、安装依赖或生成数据库迁移。

## 当前阶段

- [x] 确认产品目标、目标用户和首期范围
- [x] 确认核心业务流程、关键一致性约束和技术方向
- [x] 建立协作、架构、兼容性和 API 契约基线
- [ ] 评审并冻结首批架构决策与领域契约
- [ ] 依据已确认契约建立第一个端到端纵向切片

完整阅读入口见 [项目文档索引](docs/README.md)。范围索引见 [产品需求](docs/product/requirements.md)，架构入口见 [架构总览](docs/architecture/overview.md)，API 契约入口见 [API 文档](docs/api/README.md)。

## 协作原则

1. 代码、测试和文档在同一个变更中同步更新。
2. API 采用契约优先；接口实现不得先于契约变更合入。
3. 兼容行为必须声明范围、失败语义和移除条件。
4. 未确认的业务事实不得用默认值或技术兜底伪装成成功。
5. 重要架构选择通过 ADR 记录原因、影响与替代方案。

开始贡献前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

安全问题不得通过普通 Issue 披露，处理方式见 [SECURITY.md](SECURITY.md)。

团队分工入口见 [协作就绪清单](docs/development/collaboration-readiness.md) 与 [协作任务队列](docs/development/task-board.md)。
