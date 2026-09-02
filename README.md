# 知径（Zhijing）

知径是一款基于知乎真实内容构建学习路径的 Web 教育产品。它将分散的真实讨论组织成有先后关系、可追溯、可验证的学习地图。

> 把知乎上的真实讨论，走成一条学会的路。

完整产品事实以 [PROJECT_GOAL.md](PROJECT_GOAL.md) 为准。仓库已建立 Next.js 15 工程基础、PostgreSQL/Drizzle 迁移、Better Auth 邮箱身份后端以及已发布精选地图读取后端；当前页面仍是非业务工程壳，产品登录/注册和学习地图界面由前端工作继续实现。

## 当前阶段

- [x] 确认产品目标、目标用户和首期范围
- [x] 确认核心业务流程、关键一致性约束和技术方向
- [x] 建立协作、架构、兼容性和 API 契约基线
- [x] 评审并冻结身份、地图版本、生成运行、学习计分和自定义地图授权决策
- [x] 建立固定运行时、分层检查、测试入口与 CI 工程基础
- [x] 建立强制邮箱验证、数据库 Session 和服务端正式身份纵向切片
- [x] 建立不可变地图版本、精选指针、来源证据与受保护读取接口
  - 前端接入见[精选学习地图接口](docs/api/featured-learning-maps.md)
- [x] 将分享移出一期范围，结课报告收敛为所属账户私有能力
- [ ] 冻结外部真实样本，推进自定义地图读取、生成和学习闭环

完整阅读入口见 [项目文档索引](docs/README.md)。范围索引见 [产品需求](docs/product/requirements.md)，架构入口见 [架构总览](docs/architecture/overview.md)，API 契约入口见 [API 文档](docs/api/README.md)。

## 开始开发

环境要求、安装和完整命令见 [本地开发](docs/development/local-setup.md)，测试层级见 [测试策略](docs/development/testing.md)。

```bash
corepack enable
corepack prepare pnpm@11.25.0 --activate
pnpm install --frozen-lockfile
cp .env.example .env.local
docker compose up -d postgres postgres-test
```

随后按[本地开发](docs/development/local-setup.md)替换密钥、导出环境并执行迁移。`pnpm check` 是本地与 CI 共用入口，需要专用测试数据库。认证端点与安全语义见[认证框架契约](docs/api/authentication.md)。

## 协作原则

1. 代码、测试和文档在同一个变更中同步更新。
2. API 采用契约优先；接口实现不得先于契约变更合入。
3. 兼容行为必须声明范围、失败语义和移除条件。
4. 未确认的业务事实不得用默认值或技术兜底伪装成成功。
5. 重要架构选择通过 ADR 记录原因、影响与替代方案。

开始贡献前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

安全问题不得通过普通 Issue 披露，处理方式见 [SECURITY.md](SECURITY.md)。

团队分工入口见 [协作就绪清单](docs/development/collaboration-readiness.md) 与 [协作任务队列](docs/development/task-board.md)。
