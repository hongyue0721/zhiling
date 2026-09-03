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

常规本地运行的 `.env.local` 中必须配置 `BETTER_AUTH_SECRET`。实际发送验证邮件前，还必须配置真实 `RESEND_API_KEY` 与已在 Resend 验证域名下的 `AUTH_EMAIL_FROM`；运行现场地图生成 Worker 前必须配置真实知乎供应方凭据。本地 Demo 使用 `compose.demo.yaml` 内置的隔离值，不读取 `.env.local`，见下文。项目不提供万能密钥、假发信成功、假供应方成功或生产默认值。

## 本地 Demo

本节提供与普通开发环境隔离的固定演示路径。它不需要 `.env.local`、真实 `RESEND_API_KEY`、已验证的 `AUTH_EMAIL_FROM` 或知乎供应方凭据；只需准备好 Docker Compose 并完成依赖安装。

```bash
pnpm demo
```

`pnpm demo` 等价于 `docker compose -f compose.demo.yaml up --build`，使用独立 Compose 项目 `zhijing-local-demo`。它会构建本地镜像，启动 `demo-postgres`，等待 PostgreSQL 健康后运行 `demo-prepare`（迁移、准备账号和固定内容），再启动 `demo-web`。命令以前台方式保持服务运行，请保留该终端。

打开 `http://localhost:3000/auth`，使用以下固定凭据登录：

- 邮箱：`demo@zhijing.local`
- 密码：`Zhijing-demo-only-2026`

`demo-prepare` 通过 Better Auth 正规邮箱注册流程创建账号，使用本地记录的验证链接完成邮箱验证，再以固定凭据登录核验；其不对外监听的进程内认证实例显式关闭限流，不会消耗随后 Web 登录的限流额度，也不会发送真实邮件。重复运行准备阶段时，等价的固定账号、地图和题目集会复用；如发现冲突数据，准备过程会拒绝重置或覆盖。

Demo 预置一张固定的五节点线性学习地图和对应题目集：可以体验加入地图、按先修关系学习、查看来源与观点、完成节点验证、恢复进度并查看私人报告。题目集每个节点包含两题，覆盖单选、多选、匹配和观点辨析四种题型。

Demo 地图中的固定样本及其三条知乎公开链接仅供本地体验和阅读，不是生产精选内容、真实供应方成功样本、生成 Worker 成功证据或线上可用性依据。Demo 不启动 generation Worker，也不配置真实邮件或知乎供应方。

在 Demo 模式下，认证页只开放固定账号登录；注册和重发验证邮件在 UI 与服务端均被禁用，不会向外部邮件服务提交用户输入。首页和 `/generate` 页面会禁用现场生成的输入和提交控件，并提示使用固定地图；现场生成不会接收任务，也不会留下无法处理的排队任务。登录后调用 `POST /api/map-generations` 时，API 返回 HTTP `503`，错误码为 `generation_unavailable`。

Demo 使用独立的 PostgreSQL 数据库和持久卷，不会复用普通开发 Compose 的应用库或测试库。默认将 Demo PostgreSQL 绑定到 `127.0.0.1:55432`（可通过 `ZHIJING_DEMO_DATABASE_PORT` 调整）；卷名为 `zhijing-local-demo-postgres`。因此停止后再次启动仍会保留 Demo 账号和已产生的学习进度，准备阶段会继续复用等价的固定对象。

停止 Demo（保留持久数据）：

```bash
pnpm demo:down
```

若要同时删除 Demo 容器和持久卷，清除账号、进度及固定内容，执行：

```bash
docker compose -f compose.demo.yaml down --volumes
```

下次运行 `pnpm demo` 会重新迁移并准备固定账号和内容。上述 `--volumes` 只针对 Demo Compose；普通开发数据库的清理规则仍见下文。

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

`pnpm dev` 默认在 `http://localhost:3000` 启动。`pnpm start` 需要先完成 `pnpm build`。`pnpm worker:generation` 在独立进程轮询 PostgreSQL；Web 无需读取供应方凭据。正式登录/注册、精选加入与关系恢复、学习地图、答题、报告和现场生成状态页面已实现；认证托管端点及调用约束见[认证框架契约](../api/authentication.md)。

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

Issue #14 本地验收使用专用测试 PostgreSQL。E2E fixture 会注册测试账户、在测试库中完成邮箱验证标记，并发布固定五节点合成地图和四题型题目集；fixture 仅用于测试，不是生产精选内容或在线生成成功证据。浏览器 smoke 与定向证据见[Issue #14 验收证据](issue-14-acceptance.md)。

本次验收没有执行上述全量 `pnpm check`、完整测试、构建或生产演练；不要把本地测试库、合成来源或 `202 queued` 任务解释为真实供应方成功。

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
