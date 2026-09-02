# Changelog

所有对使用者可见的重要变更记录在此。版本策略将在首个可发布产品范围确认后确定。

## Unreleased

### Added

- 建立项目协作、架构、兼容性和 API 契约基线。
- 建立系统上下文、领域契约、地图生成流程、安全边界和并行工作包。
- 记录模块化单体、来源证据、外部适配器、生成状态机和契约优先的首批架构决策。
- 建立工程目录、业务 API 错误、文档治理、并行交接、所有权和评审契约。
- 建立功能、缺陷与架构决策 Issue Form，以及可执行协作检查工作流。
- 建立 GitHub 决策与工作包任务队列。

- 建立固定 Node.js/pnpm、Next.js 15、TypeScript、Tailwind、ESLint、Prettier 与分层测试工程基础。
- 建立环境配置显式验证、服务端/客户端隔离，以及具有正反例夹具的架构边界检查。
- 建立本地与 CI 共用质量入口和最小非业务页面壳。
- 引入项目级官方知乎 Skill `0.2.1`，登记公共 HTTP、用户数据、OAuth、MCP、额度和已知协议缺口。
- 建立 Better Auth `1.7.2` 邮箱身份后端、PostgreSQL/Drizzle 迁移、Resend HTTP 适配器与统一服务端正式身份门禁。
- 建立真实 PostgreSQL 认证集成测试、本地应用/测试数据库编排和 CI 数据库服务。

### Changed

- 所有产品能力调整为必须登录后使用，不再支持匿名会话或匿名学习数据。
- GitHub 合并方式调整为仅允许 rebase，并限制 Actions 为 GitHub 官方 Action。
- 邮箱账户策略确认为强制验证、Resend 发信、数据库 Session 与一期不提供密码恢复。
- 将 Vitest 升级至 `3.2.6`，并覆盖存在已知漏洞的传递 PostCSS/esbuild 版本；生产依赖审计无已知漏洞。
