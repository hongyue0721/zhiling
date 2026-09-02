# 测试策略

测试层级使用独立命令，`pnpm test` 按层组合执行；端到端通过不能替代架构、契约或领域失败路径验证。

| 层级 | 命令 | 文件归属 | 当前职责 |
| --- | --- | --- | --- |
| 单元 | `pnpm test:unit` | 邻近源码的 `*.test.ts(x)` | 纯规则、配置验证和值转换 |
| 架构 | `pnpm test:architecture` | `tests/architecture` | 依赖方向、循环、运行时与生成代码边界 |
| 契约 | `pnpm test:contracts` | 邻近源码的 `*.contract.test.ts(x)`、`tests/contracts` | HTTP/SSE、公开模块契约及第三方契约 |
| 集成 | `pnpm test:integration` | `tests/integration` | 真实数据库和关键基础设施边界 |
| 端到端 | `pnpm test:e2e` | `tests/e2e` | 少量关键用户闭环 |

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

## 编写要求

- 缺陷修复必须包含能在修复前复现问题的回归测试；
- 测试应验证可观察行为、边界、不变量和真实失败语义，不验证源码文本或实现细节；
- 契约优先变更必须同步更新事实源和契约测试；
- 集成测试使用真实基础设施边界，不用 mock 冒充集成；
- 端到端测试首次运行前执行 `pnpm exec playwright install chromium`。

本地与 CI 的完整入口均为 `pnpm check`。
