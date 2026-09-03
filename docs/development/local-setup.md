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

## 真实 API 本地运行

本节启动的是独立的真实 API Compose 项目 `zhijing-real-api`，不是 Demo，也不是普通本地开发数据库。它会让 Web 通过 `http://localhost:3001` 提供服务，让独立 `generation-worker` 使用真实知乎供应方凭据；当前仓库没有用户的真实 Resend/知乎凭据，因此本节是可执行 runbook，不是已经完成的在线验收结论。

**费用与外部副作用先确认**：真实模式的每次知乎搜索、每次知乎直答都会消耗供应方对应额度；注册和重发验证邮件都会调用 Resend 并向目标邮箱发信；完整生成会进行多次搜索和多次直答。只用自己有权使用的账号、邮箱和主题执行。浏览器绝不持有 `RESEND_API_KEY` 或 `ZHIHU_ACCESS_SECRET`，不要把 `.env.real.local` 提交、复制进工单或粘贴到浏览器控制台。

### 1. 复制配置并填写来源

从仓库根目录执行：

```bash
cp .env.real.example .env.real.local
```

`.env.real.local` 已被 `.gitignore` 的 `.env.*` 规则忽略；只修改这个本地文件，不要修改模板来放入真实值。Compose 会在内部生成真实 API 专用 PostgreSQL 连接串（数据库名 `zhijing_real`），不需要把 `DATABASE_URL` 写入该文件。

以下是 `.env.real.example` 中变量的来源和是否必需。表内的固定值是协议/本地拓扑要求，不是密钥示例；带“真实凭据”的字段必须从对应供应方账户取得，不能填写占位文本。

| 变量                                                                         | 必填性              | 来源与填写规则                                                                                                                          |
| ---------------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`                                                         | 必填                | 本机生成的至少 32 字符随机值，例如使用密码管理器或 `openssl rand -base64 32`；不要复用 Demo 或生产值。                                  |
| `BETTER_AUTH_URL`                                                            | 建议保留模板值      | 本地真实 Web 的公开 Origin，固定为 `http://localhost:3001`；Compose 默认值也是它。                                                      |
| `BETTER_AUTH_TRUSTED_ORIGINS`                                                | 建议保留模板值      | Better Auth Origin 白名单，填写 `http://localhost:3001,http://127.0.0.1:3001`，必须与实际访问入口一致。                                 |
| `BETTER_AUTH_TRUSTED_PROXIES`                                                | 建议保留模板值      | 本地只信任回环代理地址 `127.0.0.1/32`；不要填写 `0.0.0.0/0`。                                                                           |
| `RESEND_API_KEY`                                                             | Web 必填真实凭据    | 从 Resend 控制台创建的服务端 API Key；只放 `.env.real.local`，不放 `NEXT_PUBLIC_` 变量或浏览器。                                        |
| `AUTH_EMAIL_FROM`                                                            | Web 必填真实值      | Resend 已验证域名下的发件人地址，例如 `知径 <auth@your-verified-domain.example>`；域名未验证会导致投递失败。不要照抄示例域名。          |
| `ZHIHU_ACCESS_SECRET`                                                        | Worker 必填真实凭据 | 从知乎开放平台开发者控制台取得的服务端 Access Secret；只注入 Worker，不复制给 Web 或浏览器。                                            |
| `ZHIHU_MODEL`                                                                | 必须使用冻结值      | 保持 `zhida-thinking-1p5`；这不是可任意替换的模型示例。                                                                                 |
| `ZHIHU_SOURCE_TIMEOUT_MS`、`ZHIHU_MODEL_TIMEOUT_MS`                          | 有默认值            | 保留模板的 `30000`/`60000` 毫秒，或按项目允许范围调整；它们是服务端超时策略，不是供应方 SLA。                                           |
| `REAL_API_VERIFY_TOPIC`                                                      | 有默认值            | 脱敏探针使用的 1–200 字符主题；可改成自己有权查询的主题。探针会真实调用两个端点。                                                       |
| `GENERATION_WORKER_ID`                                                       | 可选                | 本机单 Worker 的稳定标识；多 Worker 时每个实例必须不同。                                                                                |
| `GENERATION_RATE_LIMIT_WINDOW_SECONDS`、`GENERATION_RATE_LIMIT_MAX_REQUESTS` | 有默认值            | 生成请求限流策略；模板默认 `3600` 秒/`5` 次，只影响本地真实 Web 的任务入口。                                                            |
| `ZHIJING_REAL_WEB_PORT`、`ZHIJING_REAL_DATABASE_PORT`                        | 可选                | 宿主机端口覆盖；默认 Web `3001`、PostgreSQL `55433`。若修改 Web 端口，必须同步调整 `BETTER_AUTH_URL` 和 `BETTER_AUTH_TRUSTED_ORIGINS`。 |

Compose 真正强制提供的外部/安全值是 `BETTER_AUTH_SECRET`、`RESEND_API_KEY`、`AUTH_EMAIL_FROM` 和 `ZHIHU_ACCESS_SECRET`；其余变量即使有 Compose 默认值，也应保留模板中的本地拓扑和冻结协议值。不要在文档、Shell 历史、截图或日志中展示四个真实值。

### 2. 启动真实 API

在填写并保存 `.env.real.local` 后，从仓库根目录执行：

```bash
pnpm real
```

该命令等价于 `docker compose --env-file .env.real.local -f compose.real.yaml up --build`，以前台方式运行独立的 `postgres`、一次性 `migrate`、`web` 和 `generation-worker`。迁移成功后 Web 监听容器 `3000` 并映射到宿主机 `http://localhost:3001`；真实 API PostgreSQL 默认只绑定宿主机 `127.0.0.1:55433`。保留该终端运行服务；后续步骤在另一个终端执行。Compose Web 健康检查在容器内访问 `127.0.0.1:3000`，不要因为宿主端口是 `3001` 而修改容器内检查地址。

### 3. 运行知乎脱敏探针

确认真实 Compose 已启动后，在另一个终端执行：

```bash
pnpm real:verify:zhihu
```

该命令在真实 Worker 镜像内复用项目的 `createExternalProviderRuntime`，按顺序调用**一次**知乎搜索和**一次**知乎直答 `planDirections`。成功输出仅为脱敏元数据（供应方、结果计数和适配器版本，不输出搜索标识）；失败只输出稳定错误码、可重试性和可选等待时间，不输出 Access Secret、查询正文或供应方响应正文。它证明的范围只包含这两个适配器调用，不证明邮件投递或完整地图生成；每次执行都会消耗两个供应方端点的额度。当前没有真实凭据时，预期是安全失败，不能用 fixture 或 Demo 输出替代成功样本。

### 4. 用真实邮箱完成注册与验证

1. 打开 `http://localhost:3001/auth?mode=sign-up`，使用自己可访问且允许接收测试邮件的地址和至少 12 字符密码注册；浏览器只提交邮箱、称呼和密码，不会看到 Resend Key。
2. 注册请求由 Better Auth 写入真实 API PostgreSQL 的 `user`/`account`/`verification`，随后由 Web 服务端调用 Resend。页面的“已受理”不等于邮件已送达；投递失败不会把账户创建伪装成成功。
3. 打开收到的验证邮件链接。链接通过 `GET /api/auth/verify-email` 消费一次性 Token（有效期 1 小时），完成后返回 `/auth?verified=1`；验证不会自动登录。
4. 回到认证页显式登录。成功后 Better Auth 只向浏览器设置 HttpOnly Session Cookie；访问首页、精选目录或学习关系时由服务端从数据库 Session 解析正式身份。
5. 若邮件未到达，使用认证页重发按钮（仍会实际调用 Resend 并受限流保护），不要在浏览器中手工放入服务端密钥。认证端点和失败语义见[认证框架契约](../api/authentication.md)。

### 5. 从 UI 完成真实生成验收

探针通过并登录后，必须从浏览器验证完整链路，而不是直接写数据库或只观察 `202`：

1. 打开 `http://localhost:3001/generate`，输入 1–200 字符主题并提交。浏览器调用 `POST /api/map-generations`，服务端把任务和当前账户参与关系写入真实 API PostgreSQL，返回 `202` 和 `queued` 快照。
2. 保持页面打开观察可恢复 SSE。页面连接 `GET /api/map-generations/{taskId}/events`，以 `Last-Event-ID` 重连；Worker 通过 PostgreSQL 租约推进 `planning`、`searching`、`structuring`、`supplementing`、`extracting`、`assessing`、`validating`、`publishing` 等阶段。
3. 观察 Worker 实际调用知乎搜索和知乎直答，并等待 SSE 终态。终态后页面必须再读取授权的 `GET /api/map-generations/{taskId}` 快照；只有快照中的 `succeeded` 和 `learningRelationshipId` 才能作为成功导航依据。阶段事件或 `202` 本身不是生成成功证据。
4. 进入生成出的 `/learn/{learningRelationshipId}`，确认地图节点、先修关系、知乎来源和观点可读取；按页面提供的题面完成答题，确认 `GET /api/learning-relationships/{learningRelationshipId}/progress` 的节点成绩/完成度更新，再打开 `/learn/{learningRelationshipId}/report` 确认私人报告只属于当前账户。
5. 记录脱敏的任务 ID、阶段、终态、版本和错误分类即可；不要记录邮箱、Session Cookie、Access Secret、供应方响应、候选正文或答案。完整 HTTP/SSE 字段见[自定义学习地图生成接口](../api/map-generation.md)，外部调用边界见[知乎开放平台外部适配契约](../api/zhihu-open-platform.md)。

完整生成的每个阶段可能产生多次在线搜索/直答，因此会消耗相应额度；真实邮箱注册和重发也会发送邮件。没有用户真实凭据时，不得把本节步骤写成“已通过”，也不得把本地 Demo、合成 fixture、契约测试或仅返回 `202` 的任务当作知乎成功样本。

### 6. 停止与清理

停止真实 API（保留真实 API PostgreSQL 持久卷，便于下次继续使用同一环境）：

```bash
pnpm real:down
```

若确认要删除真实 API 的本地账户、Session、学习进度、任务和生成地图，再执行：

```bash
docker compose --env-file .env.real.local -f compose.real.yaml down --volumes
```

该 `--volumes` 只删除真实 API Compose 的 `zhijing-real-api-postgres` 卷，不影响 Demo 的 `zhijing-local-demo-postgres` 或普通开发数据库。需要彻底清除凭据时，在服务停止后使用本机安全方式删除 `.env.real.local`；不要为了清理而修改 `.env.real.example`，也不要提交 `.env.real.local`。

真实 API 停止/清理后，普通本地开发和 Demo 仍按上文各自的 Compose 项目执行；三者不得共享数据库卷或把 Demo 凭据带入真实模式。

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
