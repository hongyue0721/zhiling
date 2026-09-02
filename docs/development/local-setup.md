# 本地开发

## 工具版本

- Node.js `22.23.2`，版本事实源为 `.node-version` 与 `package.json#engines`；
- pnpm `11.25.0`，版本事实源为 `package.json#packageManager`；
- Git。

Node.js 版本必须精确匹配，pnpm 会通过 `engine-strict` 拒绝其他运行时。Node.js 22 自带 Corepack，可执行：

```bash
corepack enable
corepack prepare pnpm@11.25.0 --activate
node --version
pnpm --version
```

## 从干净环境安装

```bash
git clone <repository-url>
cd zhijing
pnpm install --frozen-lockfile
cp .env.example .env.local
```

`.env.local` 中必须替换 `BETTER_AUTH_SECRET`。实际发送验证邮件前，还必须配置真实 `RESEND_API_KEY` 与已在 Resend 验证域名下的 `AUTH_EMAIL_FROM`；运行现场地图生成 Worker 前必须配置真实 `ZHIHU_ACCESS_SECRET`。项目不提供万能密钥、假发信成功、假供应方成功或生产默认值。

## 数据库与迁移

本地应用库和可丢弃的集成测试库相互隔离：

```bash
docker compose up -d postgres postgres-test
set -a
. ./.env.local
set +a
pnpm db:migrate
```

- 应用 PostgreSQL：`127.0.0.1:5432/zhijing`，使用持久卷；
- 测试 PostgreSQL：`127.0.0.1:5433/zhijing_test`，使用容器临时文件系统；
- 集成测试会清空 `TEST_DATABASE_URL` 指向数据库中的认证表，并拒绝数据库名不以 `_test` 结尾的连接；严禁指向生产库或开发应用库；
- 修改认证 schema 后运行 `pnpm db:generate`，审查 SQL 与 `drizzle/meta`，再执行迁移；Drizzle adapter 不使用 Better Auth 内建迁移命令。

## 启动与构建

保持上述环境变量已导出，然后执行：

```bash
pnpm dev
pnpm build
pnpm start
pnpm worker:generation
```

`pnpm dev` 默认在 `http://localhost:3000` 启动。`pnpm start` 需要先完成 `pnpm build`。`pnpm worker:generation` 在独立进程轮询 PostgreSQL；Web 无需读取知乎密钥。产品登录/注册页面尚未实现；认证托管端点及调用约束见[认证框架契约](../api/authentication.md)。

## 质量与测试

```bash
pnpm format
pnpm format:check
pnpm lint
pnpm typecheck
pnpm architecture
pnpm test
pnpm check
```

`pnpm check` 是本地与 CI 共用入口，要求应用库、测试库与认证环境变量可用，依次执行格式、静态、类型、架构、所有测试层级和构建。各测试层的独立命令见[测试策略](testing.md)。

首次执行端到端测试前安装浏览器：

```bash
pnpm exec playwright install chromium
pnpm test:e2e
```

## 配置规则

- 服务端配置通过 `src/platform/config/server.ts` 读取，并由 `server-only` 阻止进入客户端模块图；
- 客户端配置必须在调用处逐项映射 `NEXT_PUBLIC_` 变量，并通过 `src/platform/config/client.ts` 验证；
- 缺失或无效配置抛出 `EnvironmentConfigurationError`，错误只报告字段与错误码，不包含配置值；
- `BETTER_AUTH_TRUSTED_PROXIES` 必须填写实际反向代理 IP 或 CIDR；部署时源站必须只允许这些代理访问，不能信任客户端可自行伪造的 `X-Forwarded-For`；
- 禁止把服务端密钥改名为 `NEXT_PUBLIC_`，也禁止把个人机器上的未登记配置作为安装步骤。

## 常见问题与清理

- 运行时或 pnpm 版本不匹配：切换到上述精确版本后重新安装；
- 锁文件不一致：不要忽略 `--frozen-lockfile`，应在依赖变更中重新生成并审查 `pnpm-lock.yaml`；
- 依赖新增构建脚本时，pnpm 会拒绝安装；审查脚本来源与锁定版本后，才可在 `pnpm-workspace.yaml#allowBuilds` 中按精确版本放行；
- 停止本地数据库：`docker compose down`；同时删除开发数据时才使用 `docker compose down --volumes`。
- 清理本地派生目录时可删除 `.next/`、`coverage/`、`playwright-report/` 和 `test-results/`，不要删除或手工修改锁文件。
