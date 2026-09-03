# 测试策略

测试层级使用独立命令，`pnpm test` 按层组合执行；端到端通过不能替代架构、契约或领域失败路径验证。

| 层级   | 命令                     | 文件归属                                              | 当前职责                             |
| ------ | ------------------------ | ----------------------------------------------------- | ------------------------------------ |
| 单元   | `pnpm test:unit`         | 邻近源码的 `*.test.ts(x)`                             | 纯规则、配置验证和值转换             |
| 架构   | `pnpm test:architecture` | `tests/architecture`                                  | 依赖方向、循环、运行时与生成代码边界 |
| 契约   | `pnpm test:contracts`    | 邻近源码的 `*.contract.test.ts(x)`、`tests/contracts` | HTTP/SSE、公开模块契约及第三方契约   |
| 集成   | `pnpm test:integration`  | `tests/integration`                                   | 真实数据库和关键基础设施边界         |
| 端到端 | `pnpm test:e2e`          | `tests/e2e`                                           | 少量关键用户闭环                     |

单元、架构、契约和集成层已有真实测试，命令在测试文件被误删时必须失败。产品前端闭环尚未实现，因此仅 Playwright 暂时使用 `--pass-with-no-tests` 保持入口可组合；这不算端到端覆盖，也不得用空测试伪装进度。

## 架构测试

`pnpm architecture` 检查生产 `src`，`pnpm test:architecture` 同时用正反例夹具证明规则确实能够接受和拒绝：

- 跨模块只能访问 `public/contracts.ts`、`public/server.ts` 或 `public/client.ts`，且依赖必须登记在 `architecture.config.mjs`；
- 领域、应用、基础设施、展示、组合根、平台与共享代码遵循 ADR-0008 的方向；
- 本地依赖图不能成环；
- `\"use client\"` 依赖图不能触达 `server-only`、服务端入口、基础设施或非公开环境变量；
- 领域、应用和模块公开入口不能依赖 `src/generated`，生成代码不能反向依赖手写应用代码。

架构夹具中的 `alpha`、`beta` 仅是静态规则输入，不是业务模块或生产门面。

## 身份认证测试

`tests/integration/identity-auth.test.ts` 必须连接 `TEST_DATABASE_URL` 指向且数据库名以 `_test` 结尾的专用 PostgreSQL，执行 `drizzle/` 迁移并清空其中认证表。测试拒绝在变量缺失或数据库名称不安全时运行；本地启动方式见[本地开发](local-setup.md)。

当前覆盖：

- 注册不建 Session、未验证登录拒绝、显式重发验证、验证后仍需显式登录；
- 重复注册、已知/未知邮箱登录失败及重发验证保持不可枚举的响应状态和错误码；
- 跨请求恢复同一正式身份，公开结果不含 Session Token 或框架对象；
- 当前退出、按 Token 撤销与数据库过期在下一次身份解析立即失效；
- 一期允许列表之外的密码恢复、账户修改、删除和错误方法在进入 Better Auth 前返回空 `404`；
- Resend HTTP 失败正文、API Key、验证 Token 与完整验证 URL 不进入响应或日志；
- 身份客户端依赖图不能触达服务端入口、数据库或邮件适配器。

邮件 HTTP 契约测试使用注入的 `fetch`，不会访问 Resend 外网；真实投递依赖人工提供已验证域名和真实密钥，不属于自动测试。

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

## 最近一次完整验证

2026-09-02 对 C1、C2、C3、D1 和 D2 执行了完整质量门禁：

- 单元测试 58 项、架构测试 10 项、契约测试 54 项、PostgreSQL 集成测试 25 项，共 147 项通过；
- C3 覆盖知乎搜索与直答的成功样本、缺字段、未知枚举、鉴权、限流、暂时不可用、严格模型 JSON 和关系闭合；
- D1 覆盖并发任务复用、六小时缓存、稳定地图身份、租约心跳与接管、持久重试预算、总时限、定向补料、候选门禁、发布回滚、账户隔离和 SSE 恢复；
- Node.js `22.23.2` Docker 镜像构建成功，独立 Worker 在空队列场景完成启动与停止冒烟；
- Playwright 入口当前仍无产品端到端用例，因此 `--pass-with-no-tests` 不计入覆盖。

本次自动验证不包含使用真实 Access Secret 的知乎搜索或直答成功调用；该项仍须在受控部署环境完成，不能用文档 fixture 代替。

## 编写要求

- 缺陷修复必须包含能在修复前复现问题的回归测试；
- 测试应验证可观察行为、边界、不变量和真实失败语义，不验证源码文本或实现细节；
- 契约优先变更必须同步更新事实源和契约测试；
- 集成测试使用真实基础设施边界，不用 mock 冒充集成；
- 端到端测试首次运行前执行 `pnpm exec playwright install chromium`。

本地与 CI 的完整入口均为 `pnpm check`。
