# 测试策略

测试层级使用独立命令，`pnpm test` 按层组合执行；端到端通过不能替代架构、契约或领域失败路径验证。本页同时记录 Issue #14 已实际执行的定向证据；定向通过不等于全量质量门禁通过。

| 层级   | 命令                     | 文件归属                                              | 当前职责                             |
| ------ | ------------------------ | ----------------------------------------------------- | ------------------------------------ |
| 单元   | `pnpm test:unit`         | 邻近源码的 `*.test.ts(x)`                             | 纯规则、配置验证和值转换             |
| 架构   | `pnpm test:architecture` | `tests/architecture`                                  | 依赖方向、循环、运行时与生成代码边界 |
| 契约   | `pnpm test:contracts`    | 邻近源码的 `*.contract.test.ts(x)`、`tests/contracts` | HTTP/SSE、公开模块契约及第三方契约   |
| 集成   | `pnpm test:integration`  | `tests/integration`                                   | 真实数据库和关键基础设施边界         |
| 端到端 | `pnpm test:e2e`          | `tests/e2e`                                           | 少量关键用户闭环                     |

单元、架构、契约、集成和端到端层均有真实测试入口。`tests/e2e/user-closure.spec.ts` 当前包含用户闭环用例；E2E fixture 使用专用测试 PostgreSQL、测试账户和合成内容，只证明测试路径，不是生产精选内容或在线生成成功证据。

## 架构测试

`pnpm architecture` 检查生产 `src`，`pnpm test:architecture` 同时用正反例夹具证明规则确实能够接受和拒绝：

- 跨模块只能访问 `public/contracts.ts`、`public/server.ts` 或 `public/client.ts`，且依赖必须登记在 `architecture.config.mjs`；
- 领域、应用、基础设施、展示、组合根、平台与共享代码遵循 ADR-0008 的方向；
- 本地依赖图不能成环；
- `"use client"` 依赖图不能触达 `server-only`、服务端入口、基础设施或非公开环境变量；
- 领域、应用和模块公开入口不能依赖 `src/generated`，生成代码不能反向依赖手写应用代码。

架构夹具中的 `alpha`、`beta` 仅是静态规则输入，不是业务模块或生产门面。

## 身份认证测试

`tests/integration/identity-auth.test.ts` 必须连接 `TEST_DATABASE_URL` 指向且数据库名以 `_test` 结尾的专用 PostgreSQL，执行 `drizzle/` 迁移并清空其中认证表。测试拒绝在变量缺失或数据库名称不安全时运行；本地启动方式见[本地开发](local-setup.md)。

当前覆盖：

- 注册不建 Session、未验证登录拒绝、显式重发验证、验证后仍需显式登录；
- 重复注册、已知/未知邮箱登录失败及重发验证保持不可枚举的响应状态和错误码；
- 跨请求恢复同一正式身份，公开结果不含 Session Token 或框架对象；
- 当前退出、按 Token 撤销与数据库过期在下一次身份解析立即失效；
- 仅导出的 `GET`、`POST` 会进入认证 Route Handler；`PUT`、`PATCH`、`DELETE` 等不支持的方法由 Next.js 返回 `405 Method Not Allowed`。已导出的 `GET`/`POST` 对允许列表之外的路径才返回空 `404`；
- Resend HTTP 失败正文、API Key、验证 Token 与完整验证 URL 不进入响应或日志；
- 身份客户端依赖图不能触达服务端入口、数据库或邮件适配器。

邮件 HTTP 契约测试使用注入的 `fetch`，不会访问 Resend 外网；真实投递依赖人工提供已验证域名和真实配置，不属于自动测试。

## 精选学习地图测试

`tests/integration/learning-catalog.test.ts` 与身份集成测试共用同一个以 `_test` 结尾的专用 PostgreSQL，但由集成测试项目串行执行文件，避免迁移与清表互相竞争。

当前覆盖：

- 5–7 节点、引用唯一性、同版本先修关系、无自环和 DAG；
- 节点必须关联已存在来源，观点证据必须属于同节点，分歧必须声明适用条件；
- 来源只接受 HTTPS 知乎域名，必填地图、节点、来源与观点事实不得为空；
- 完整图与证据在单事务发布，最后切换精选指针，失败不留下可见半成品；
- 草稿、非精选和不存在地图不进入读投影，重新发布只切换当前版本且保留旧版本；
- 已发布版本及子内容不可变，精选指针不能指向草稿；
- HTTP 目录和详情要求正式身份，统一返回 `401`、安全 `404` 或 `500` 信封，并禁止共享缓存；
- 公共 DTO 与应用/数据库对象隔离，外部突变不能改变已校验发布快照。

## 学习验证与进度测试

`src/modules/learning-assessment/domain/assessment.test.ts` 覆盖四类题型、服务端不变量、多选误选扣分、基点取整和 80% 边界。`tests/integration/learning-assessment.test.ts` 使用真实 PostgreSQL 覆盖题目集版本/来源拒绝、题面答案隔离、幂等重复、低分后高分、高分后低分不回退、不可变尝试与重新读取进度恢复。

HTTP 契约测试验证节点题面、答案提交和关系进度路由的 DTO、错误信封与 `Idempotency-Key`；不得把标准答案或提交答案放入公开题面及历史摘要。正式身份门禁复用统一 Route Handler 模式和既有身份契约测试。

## 私人结课报告测试

`src/modules/learning-report/domain/learning-report.test.ts` 覆盖固定关系/版本事实、完成度基点、已作答但未完成节点、观点接触、前置完成后的下一步排序、来源投影、错误事实拒绝和嵌套 DTO 隔离；领域投影明确不包含原始尝试或 `attemptId`。

`tests/contracts/learning-report-http.test.ts` 覆盖正式身份门禁、成功 DTO、私有缓存头，以及不存在关系与错误账户统一的安全 `404`。`tests/integration/learning-report.test.ts` 使用真实 PostgreSQL 验证关系所有权、固定地图/题目集版本在精选切换后不漂移，以及报告不返回答案、账户或尝试标识。

## provider 与地图生成测试

provider 契约覆盖知乎搜索、直答结构化输出、错误映射、超时和四题型（单选、多选、匹配、观点辨析）生成适配。地图生成覆盖候选门禁、持久化状态机、同主题请求复用、缓存、PostgreSQL 生成限频、租约恢复、阶段 checkpoint、重试预算、总时限、参与者授权、原子发布和 SSE 恢复。

契约和集成测试不把文档样本或本地失败 fixture 解释为真实在线成功。真实知乎/直答成功调用仍需在受控部署环境用真实供应方配置完成；本次没有该项证据。

## Issue #14 定向验证记录

以下命令和结果是已执行的定向记录，不是全量报告。命令按测试入口列出，最终统计按下表功能组汇总；测试数据库和运行环境按[本地开发](local-setup.md)准备；本文不记录任何真实配置值。

### 定向测试命令与结果

```bash
# learning catalog and featured map contract entries
pnpm exec vitest run \
  src/modules/learning-catalog/domain/learning-map.test.ts \
  src/modules/learning-catalog/application/learning-catalog.test.ts \
  src/modules/learning-catalog/public/server.contract.test.ts \
  tests/contracts/featured-learning-maps.test.ts \
  tests/integration/learning-catalog.test.ts

# provider, candidate, state-machine, and generation integration entries
pnpm exec vitest run \
  src/modules/external-providers/infrastructure/runtime.contract.test.ts \
  src/modules/map-generation/domain/candidate.test.ts \
  src/modules/map-generation/domain/state-machine.test.ts \
  tests/integration/map-generation.test.ts

# generation-rate-limit integration
pnpm exec vitest run tests/integration/generation-rate-limit.test.ts

# map-generation HTTP contract entry
pnpm exec vitest run tests/contracts/map-generation-http.test.ts

# assessment unit, public contract, HTTP, and integration entries
pnpm exec vitest run \
  src/modules/learning-assessment/domain/assessment.test.ts \
  src/modules/learning-assessment/public/server.contract.test.ts \
  tests/contracts/learning-assessment.test.ts \
  tests/integration/learning-assessment.test.ts

# learning report unit, HTTP, and integration entries
pnpm exec vitest run \
  src/modules/learning-report/domain/learning-report.test.ts \
  tests/contracts/learning-report-http.test.ts \
  tests/integration/learning-report.test.ts

# user closure E2E
pnpm test:e2e tests/e2e/user-closure.spec.ts
```

已实际结果：

| 能力 | 通过结果 |
| --- | --- |
| Drizzle migrations | `0000`–`0006` fresh 与 repeat 均成功，重复执行幂等 |
| catalog + assessment integration | `17` 项 |
| generation-rate-limit integration | `5` 项 |
| map-generation integration | `10/10`，覆盖 stale-cache 与 exact-terminal-cursor |
| generation integration subtotal | `15` 项（`10` + `5`） |
| HTTP contracts | `23` 项，其中 `tests/contracts/map-generation-http.test.ts` `7/7`；featured + assessment contracts 与其合计 `23` 项 |
| provider | `17` 项 |
| candidate + assessment unit | `16` 项 |
| 指定生成文件 | `tests/integration/map-generation.test.ts` `10/10` 与 `tests/contracts/map-generation-http.test.ts` `7/7`，合计 `17/17` |
| user closure E2E | `6/6`，耗时 `28.2s` |

### 浏览器 smoke

Next.js + Chromium 本地 smoke 实际覆盖：

- 匿名业务页 `307 → /auth`、注册/测试库验证/登录；
- 精选目录和学习关系列表 `200`、精选加入关系 `200`，以及重复加入后的关系恢复；
- 五节点 DAG 缩放、平移和重置，来源、观点分类和分歧适用条件；
- 四种题型的无答案题面（匹配选项展示服务端派生的 `left`/`right` 两侧），单选/多选/matching 提交，服务端进度刷新，报告 `2/5` 和固定版本；

测试 fixture 的固定五节点地图、题目和来源均为合成数据，仅用于测试；没有用它们证明生产精选、真实在线生成或供应方成功。

### 运维静态/解析验证

```bash
for script in ops/*.sh ops/lib/*.sh; do bash -n "$script"; done
docker compose --env-file <受限校验文件> -f compose.production.yaml config --quiet
```

已实际结果：列出的 shell 脚本 `bash -n` 通过；production Compose 配置成功解析 `postgres`、`migrate`、`web`、`generation-worker` 四个服务。production/staging health preflight 均通过到容器查询前；环境、项目或卷名的故意错配均以 `exit 1` fail closed。这些结果只证明脚本语法、配置结构和容器查询前置校验，没有执行 preflight 后的容器健康查询、真实 VPS 部署、备份恢复、租约接管、回滚或公网 SSE 演练。

### 本次未运行

本次没有运行且不能写成已通过：

- `pnpm check`、`pnpm test`、format、lint、typecheck、architecture、build；
- 其他全量质量门禁和 GitHub workflows（workflows 保持 `disabled_manually`）；
- 真实知乎搜索成功、知乎直答成功、真实生成成功和生产精选审核；
- 真实 VPS 部署、健康门禁、备份恢复、Worker 租约接管、镜像回滚和公网 SSE。

因此，定向测试与浏览器 smoke 只能证明已覆盖的本地路径；Issue #14 仍未完成。完整十项矩阵、逐项未完成条件和完成判定见[Issue #14 验收证据](issue-14-acceptance.md)。

## 编写要求

- 缺陷修复必须包含能在修复前复现问题的回归测试；
- 测试应验证可观察行为、边界、不变量和真实失败语义，不验证源码文本或实现细节；
- 契约优先变更必须同步更新事实源和契约测试；
- 集成测试使用真实基础设施边界，不用 mock 冒充集成；
- 端到端测试首次运行前执行 `pnpm exec playwright install chromium`。

本地与 CI 的完整入口均为 `pnpm check`；它是入口定义，不代表本次已执行或通过。
