# 工程目录与依赖方向

> 状态：已由 [ADR-0008](decisions/0008-project-structure-and-dependency-direction.md) 接受。工程基础与 `identity` 后端纵向切片已落地；后续业务模块仍只由对应工作包按需创建。

## 目录骨架

```text
api/                              # 对外 HTTP/SSE 机器契约及示例，契约事实源
drizzle/                          # 经评审、纳入版本控制的数据库迁移
src/
├── app/                          # Next.js 路由入口与页面组合，只承担接口层职责
│   ├── (route-groups)/           # 仅组织布局和访问策略，不作为业务模块边界
│   └── api/                      # Route Handler 与 SSE 传输适配器
├── bootstrap/                    # 服务端组合根：组装模块公开入口与平台实现
├── modules/
│   └── <module>/                 # 按业务边界独立拥有代码与测试
│       ├── domain/               # 实体、值对象、领域规则与领域事件
│       ├── application/          # 用例、事务编排、授权决策及所需端口
│       ├── infrastructure/       # 数据库仓储与第三方端口实现
│       ├── presentation/         # 模块拥有的 UI、视图模型和交互适配
│       └── public/               # 唯一允许跨模块引用的公开入口
│           ├── contracts.ts      # 跨边界 DTO、schema 与稳定错误语义
│           ├── server.ts         # 仅服务端可用的命令、查询和组装入口
│           └── client.ts         # 仅浏览器安全的组件、hook 与视图契约
├── platform/                     # 配置、数据库连接、事务、日志等技术能力
├── shared/
│   ├── kernel/                   # 经确认由多个模块共享的纯语义
│   └── ui/                       # 无业务所有权的通用展示组件
└── generated/                    # 由已登记生成器完整重建的派生代码
tests/
├── architecture/                # 目录、导入和运行时边界检查
├── contracts/                   # HTTP/SSE 与跨模块公开契约验证
├── integration/                 # 数据库及跨模块集成验证
└── e2e/                          # 少量关键用户闭环
```

只有实际需要的目录和公开入口才创建。模块没有浏览器能力时不创建 `client.ts`，没有第三方或持久化实现时不创建空的 `infrastructure/`；禁止用大量空文件伪装工程进度。

## 目录职责

### `src/app`

`src/app` 是 Next.js 接口层和最终页面组合层。框架要求的 `page`、`layout`、`loading`、`error`、Route Handler 与 Server Action 入口放在这里，但业务规则、数据库查询和供应商调用不得在这里实现。

路由组只服务于布局、登录门禁和页面组织。它不改变 URL，也不能替代 `src/modules` 中的业务边界。页面和接口入口通过模块 `public/` 或 `bootstrap/` 获取能力，不得深入模块内部目录。

### `src/modules`

一个目录对应一个已登记业务模块。模块拥有自己的领域规则、用例、端口实现、展示能力和内部测试。现有模块名称及业务数据所有权仍以 [模块边界](boundaries.md) 为准；工程结构不会重新定义业务边界。

同一模块内部依赖方向为：

```text
presentation ──→ public contracts
public/server ──→ application ──→ domain
       │                ↑              ↑
       └──→ infrastructure ─────────────┘
```

`application` 定义自己需要的仓储和外部能力端口，`infrastructure` 实现这些端口。应用层不得反向依赖基础设施具体类。

### `src/bootstrap`

组合根只负责选择实现、注入依赖和连接跨模块公开能力，不保存业务规则。跨模块调用需要适配时，由组合根把提供方的 `public/server` 能力注入消费方定义的应用端口，避免消费方读取提供方内部实现。

### `src/platform` 与 `src/shared`

`platform` 提供没有业务所有权的技术能力，例如配置读取、数据库连接、事务执行和可观测性。它不能引用任何业务模块。

`shared` 只接收已经证明具有相同语义和生命周期的跨模块代码。不得创建无边界的 `utils`、`common` 或 `helpers` 堆放区，也不得为了消除少量重复而提前抽象业务规则。

## 模块公开入口

其他目录引用模块时，只能使用下列公开入口：

| 入口 | 允许内容 | 禁止内容 |
| --- | --- | --- |
| `public/contracts.ts` | 可跨运行时传递的 DTO、运行时 schema、稳定错误和端口类型 | ORM 行、供应商 DTO、领域实体实例、密钥或框架请求对象 |
| `public/server.ts` | 服务端命令、查询、用例门面及组合所需入口 | 客户端可导入代码、数据库实现细节、第三方原始响应 |
| `public/client.ts` | 浏览器安全的组件、hook、视图 DTO 与交互入口 | 服务端配置、数据库、认证密钥、服务端用例实现 |

规则如下：

- 禁止创建导出模块全部内部实现的根级 `index.ts`；
- 模块内部可使用相对路径，跨模块一律使用稳定别名和 `public/` 路径；
- 服务端入口必须具有服务端专用保护，客户端入口不得通过间接导出带入服务端模块图；
- 公开契约是专门设计的边界对象，不直接复用数据库行、第三方 DTO 或可变领域实体；
- 跨模块依赖必须单向、登记且无环；涉及业务事务时，由拥有该用例的应用层编排；
- 若一个公开入口没有真实消费者，不提前创建空门面或“未来可能使用”的通用接口。

## 允许与禁止的依赖

| 调用方 | 允许依赖 | 明确禁止 |
| --- | --- | --- |
| `app` | `bootstrap`、模块公开入口、`shared/ui`、HTTP/SSE 传输生成类型 | 模块内部、数据库、供应商 SDK、供应商生成类型 |
| `bootstrap` | 模块 `public/server` 与 `public/contracts`、`platform` | 模块内部领域或基础设施目录、页面组件 |
| 模块 `public` | `contracts` 只依赖纯共享语义；`server` 可封装本模块应用与基础设施；`client` 可封装本模块展示层 | 向消费方暴露模块内部类型，或在 `client` 间接引入服务端代码 |
| 模块 `domain` | 本模块领域代码、`shared/kernel` | Next.js、React、ORM、数据库驱动、供应商 SDK、其他模块 |
| 模块 `application` | 本模块领域与端口、`shared/kernel`、必要的其他模块公开契约 | 本模块基础设施具体实现、Next.js 路由对象、其他模块内部 |
| 模块 `infrastructure` | 本模块应用端口与领域、`platform`、对应第三方库或生成 DTO | 其他模块数据表与内部实现、面向浏览器的入口 |
| 模块 `presentation` | 本模块公开契约、`shared/ui`、浏览器安全依赖 | 数据库、服务端环境、供应商 SDK、其他模块内部 |
| `platform` | 已确认的纯共享能力和技术依赖 | `app` 或任意业务模块 |
| `shared` | 同层或更基础的共享代码 | `app`、`bootstrap`、`platform` 或任意业务模块 |

测试可以在同一模块内访问被测内部单元，但跨模块测试仍须通过公开入口。禁止借助测试辅助代码绕过生产依赖边界。

## API 目录归属

根目录 `api/` 与 `src/app/api/` 含义不同：

- `api/openapi.yaml` 及其拆分 schema、路径和示例是 HTTP/SSE 对外契约事实源；
- `src/app/api/**/route.ts` 是 Next.js 传输适配器，只解析协议、认证、校验输入并映射响应；
- 端点所属业务模块与接口实现共同维护契约变更，不建立脱离业务模块的“API 逻辑层”；
- 模块的 `public/contracts.ts` 保存运行时边界对象，必须由契约测试证明与 OpenAPI 一致；
- OpenAPI 生成的类型或客户端是派生物，不能反过来成为领域与应用层模型。

SSE 路由同样遵循上述边界。连接保活、事件编码和恢复游标属于传输适配，任务状态与阶段转换仍属于地图生成模块。

## 测试归属

- 单元测试与模块专属契约测试使用 `*.test.ts`、`*.contract.test.ts` 邻近被测代码存放，由模块负责人同步维护；
- 第三方脱敏响应样本邻近对应基础设施适配器保存，并注明来源契约版本，不进入全局共享目录；
- `tests/architecture` 验证跨模块只能引用公开入口、服务端代码不会进入客户端依赖图、层级依赖方向和循环依赖；
- `tests/contracts` 验证 OpenAPI、HTTP/SSE 实现及跨模块公开契约；
- `tests/integration` 验证真实数据库边界、事务与跨模块协作；
- `tests/e2e` 验证注册登录、学习、生成、答题和私人结课报告等少量完整闭环。

测试层级不能替代彼此。端到端通过不能证明模块依赖或领域失败路径正确。

## 生成代码与迁移边界

- 所有可完整重建的生成代码统一放在 `src/generated/<producer>/`，目录必须声明输入、生成命令和工具版本来源；
- 生成目录禁止手工修改，生成结果必须可通过固定命令重建，并在 CI 中验证重建后无差异；
- 领域层、应用层和模块公开契约不得直接依赖 OpenAPI 或第三方生成 DTO；传输适配器与对应基础设施适配器负责显式转换；
- 生成器配置、OpenAPI 和模块边界 schema 是输入事实，生成产物不是补写业务规则的位置；
- Drizzle 迁移是经过审查的历史变更记录，位于根目录 `drizzle/` 并纳入版本控制，不按可随时删除的生成代码处理；
- `identity` 已贯通认证 Route Handler、组合根、公开服务端入口、应用/领域、Better Auth/Resend 基础设施与 PostgreSQL 平台能力；
- `learning-catalog` 已贯通精选地图 Route Handler、正式身份门禁、公开查询、地图与证据领域校验、发布/读取仓储及 PostgreSQL 持久化；两个模块在生产组合根共享同一数据库连接池；
- 产品前端仍未实现，因此不创建没有真实消费方的模块 `presentation/` 或 `public/client.ts`。

## 工程骨架验收

进入业务模块并行开发前，工程基础工作包至少应证明：

1. 路径别名只提供稳定导入方式，不允许绕过模块公开入口；
2. 静态检查或架构测试能够拒绝典型非法导入和循环依赖；
3. 客户端构建检查能够发现服务端专用模块泄漏；
4. 单元、契约、集成和端到端测试具有独立且可组合的命令入口；
5. API 或其他生成产物能够从已登记输入复现，手工漂移会使验证失败；
6. 一个真实纵向切片贯通 `app → public → application → domain/port → infrastructure`，而不是只创建空目录。
