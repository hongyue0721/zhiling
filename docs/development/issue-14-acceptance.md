# Issue #14 用户闭环验收证据

> 状态：进行中，不能标记完成。本文记录截至 2026-09-03 已实际执行的本地证据；它不是生产上线证明，也不替代 Issue #14 的外部供应方、生产运维和全量质量门禁。

## 证据边界

- 浏览器 smoke 使用本地 Next.js 应用、Chromium 和专用测试 PostgreSQL。E2E fixture 会注册测试账户、在测试库中完成邮箱验证标记，并发布固定的五节点合成地图和题目集；这些 fixture 仅用于测试，不是生产精选内容，也不是在线生成成功样本。E2E 中成功的 SSE/UI 场景只证明任务终态和当前账户快照投影，不证明独立 Worker 已用真实供应方完成成功生成。
- 当前知乎 Skill 状态为未安装、未认证，本次也未获安装授权；没有可用于受控在线验收的知乎/模型供应方凭据。因此没有真实知乎搜索成功、知乎直答成功或真实生成成功证据。
- 运维脚本只完成静态语法检查和 production Compose 配置解析证据；没有执行真实 VPS 部署、备份恢复、租约接管、回滚或公网 SSE 演练。
- 下表的“通过结果”只描述已覆盖的证据范围；“未完成条件”仍然阻止 Issue #14 完成。没有任何一项表述“已上线”“全量门禁全过”或“真实生成成功”。

## 十项项目成功标准验收矩阵

| # | 成功标准 | 实际证据命令 / 场景 | 已通过的结果（证据范围） | 未完成条件 |
| --- | --- | --- | --- | --- |
| 1 | 新用户能在三分钟内注册或登录，并开始精选地图 | `pnpm test:e2e tests/e2e/user-closure.spec.ts`；Next + Chromium smoke 覆盖匿名 `307 → /auth`、测试库注册/验证/登录、精选目录和学习关系列表 `200`、加入关系 `200` | 正式认证页面、首页精选卡片、加入学习和工作区导航均可走通 | 没有在正式环境计时三分钟目标；测试账户和本地数据库不能证明生产邮箱投递或生产体验 SLA |
| 2 | 精选主题能完成“地图 → 来源 → 多观点 → 答题 → 报告”闭环 | `pnpm test:e2e tests/e2e/user-closure.spec.ts`；精选目录/地图/答题/报告定向测试 | 五节点地图可缩放、平移和重置；来源、观点、分歧适用条件可见；完整题目集覆盖全部节点，单选、多选、匹配和观点辨析题面不含答案，匹配选项投影 `left`/`right` 两侧；smoke 已提交单选、多选、匹配；报告显示 `2/5` 和固定地图版本 | 五节点是本地合成 fixture，不是生产精选；生产需要 3–5 套真实、人工检查并持久化的精选内容证据 |
| 3 | 自定义主题使用真实知乎 API，生成过程有进度和失败状态 | `POST /api/map-generations`、任务快照读取和 `Last-Event-ID` SSE 恢复场景；用户闭环 E2E | `generation-worker` 已拆为独立进程；生成请求返回 `202 queued`，任务状态可持久化读取，SSE 支持历史重放、历史不可用时的终态/当前快照投影和可重试失败字段；高于任务当前序列的游标返回 `400 out_of_range`；E2E 成功场景仅证明 SSE/UI 当前账户快照投影，材料不足时页面显示安全失败 | 尚未在真实部署中让独立 Worker 使用受控供应方凭据完成真实知乎搜索、直答或成功发布；不把 `queued`、fixture 或 UI 快照当作真实成功 |
| 4 | 知识结论和题目解释可追溯到真实来源 | 最终定向证据组（详见下方“定向测试证据”）；E2E 题面安全检查 | provider `17` 项、candidate + assessment unit `16` 项、catalog + assessment integration `17` 项、generation-rate-limit integration `5` 项、map-generation integration `10` 项（生成集成合计 `15` 项）和 HTTP contracts `23` 项（其中 map-generation HTTP `7` 项）均通过；来源/观点/题目 source ID 关系、HTTPS 知乎链接和题面答案隔离均有覆盖 | 定向测试使用脱敏响应或本地 fixture；尚无真实在线成功样本、生产精选审核记录和真实生成产物复核 |
| 5 | 未登录不能读取或操作精选地图、生成、题目、进度和报告 | `pnpm test:e2e tests/e2e/user-closure.spec.ts`；匿名页面 smoke 和第二账户隔离场景 | 匿名业务页统一重定向认证入口；错误账户对关系、地图、题目、进度、报告、任务和 SSE 统一安全 `404`，不泄漏私有值 | 该证据来自本地 E2E；全量门禁、生产反向代理和正式身份配置尚未完成验收 |
| 6 | 重新登录后能恢复地图、进度和答题记录 | `pnpm test:e2e tests/e2e/user-closure.spec.ts`；重复加入、关系列表、进度读取场景 | 同一账户重复加入同一精选版本返回同一关系；首页恢复学习关系，地图和服务端完成状态可重新读取 | 尚未做真实跨设备/生产会话恢复演练；测试库的固定身份生命周期不能代替生产验收 |
| 7 | 私人报告只基于服务端事实，错误账户无法读取 | HTTP contracts 定向组与 E2E 隔离场景 | HTTP contracts 定向组 `23` 项覆盖私人报告授权、DTO、缓存头和答案/账户/尝试标识隔离；报告固定地图/题目版本，第二账户得到安全 `404` | 未执行全量质量门禁；生产数据、备份恢复后的报告一致性和真实发布环境授权仍未演练 |
| 8 | 供应方凭据不出现在客户端、响应、日志或数据库 | E2E `expectNoPrivateLeak` 检查；生成任务快照、SSE 和错误场景；HTTP contracts 定向组 | 公开快照、题面、报告和 SSE 不含 provider payload、用户身份、Session、attempt ID 或正确答案；HTTP contracts 定向组 `23` 项通过 | 未检查正式构建产物、生产日志和生产数据库；不能把本地响应检查升级为生产环境证明 |
| 9 | 外部 API/模型暂时不可用时，精选演示路径仍可用 | Next + Chromium smoke；E2E 现场生成安全失败场景；精选地图独立读取场景 | 生成任务可明确显示材料不足且不发布半成品；持久化精选 fixture 不依赖现场 Worker，仍可打开地图、来源、答题和报告 | 没有生产精选内容，也没有在正式部署中制造/观察供应方故障；本地 fixture 不能证明生产演示稳定性 |
| 10 | 核心业务逻辑有可读、可维护的自动化测试 | 最终定向测试、迁移验收和 `pnpm test:e2e tests/e2e/user-closure.spec.ts` | Drizzle 迁移 `0000`–`0006` fresh/repeat 均成功且幂等；catalog + assessment integration `17` 项、generation-rate-limit integration `5` 项、map-generation integration `10` 项（两项生成集成合计 `15` 项）、HTTP contracts `23` 项、provider `17` 项、candidate + assessment unit `16` 项，以及 E2E `6/6`（`28.2s`）通过 | `pnpm check`、format/lint/typecheck/architecture/build、完整测试组合和 GitHub workflows 本次均未运行；不能称为全量门禁通过 |

## 浏览器 smoke 实际覆盖

使用本地 Next.js + Chromium 实际走过以下路径：

1. 匿名访问业务页面收到 `307` 并进入认证入口；完成注册、测试库验证标记和登录后进入首页。
2. 首页精选目录与已有学习关系列表返回 `200`；精选加入关系返回 `200`，重复加入恢复同一关系。
3. 五节点 DAG 工作区支持缩放、平移和重置；节点面板显示来源、观点分类和分歧适用条件。
4. 四种题型都以无答案题面展示，匹配选项显示服务端派生的 `left`/`right` 两侧；已实际提交单选、多选和匹配答案，进度从服务端刷新，报告显示 `2/5` 与固定版本信息。
5. 现场生成页面提交后看到 `202 queued`，任务快照可持久化读取；在未执行真实 Worker/供应方调用的本地验收场景中验证安全失败展示，不把失败伪装为成功。

以上步骤使用的是测试数据库和合成内容。浏览器 smoke 没有验证真实知乎/直答成功、独立 Worker 的真实成功运行，也没有验证公网生产部署。

## 定向测试证据

以下为已执行的定向结果，不是全量测试报告：

| 能力 | 实际结果 |
| --- | --- |
| Drizzle migrations | `0000`–`0006` fresh 与 repeat 均成功，重复执行幂等 |
| catalog + assessment integration | `17` 项通过 |
| generation-rate-limit integration | `5` 项通过 |
| map-generation integration | `10/10` 通过，覆盖 stale-cache 与 exact-terminal-cursor；两项生成集成合计 `15` 项 |
| HTTP contracts | `23` 项通过，其中 `tests/contracts/map-generation-http.test.ts` `7/7`；featured + assessment contracts 与其合计 `23` 项 |
| provider | `17` 项通过，覆盖知乎/直答结构化协议和错误边界 |
| candidate + assessment unit | `16` 项通过，覆盖候选门禁、四题型与评分规则 |
| 指定生成文件 | `tests/integration/map-generation.test.ts` `10/10` 与 `tests/contracts/map-generation-http.test.ts` `7/7`，合计 `17/17` |
| user closure E2E | `6/6` 通过，耗时 `28.2s`，覆盖匿名门禁、精选闭环、资源隔离、SSE/UI 快照投影和安全失败 UI |

## 运维静态/解析证据

已执行：

```bash
for script in ops/*.sh ops/lib/*.sh; do bash -n "$script"; done
docker compose --env-file <受限校验文件> -f compose.production.yaml config --quiet
```

结果：所有列出的 shell 脚本 `bash -n` 通过；production Compose 配置成功解析 `postgres`、`migrate`、`web`、`generation-worker` 四个服务。production/staging health preflight 均通过到容器查询前；环境、项目或卷名的故意错配均以 `exit 1` fail closed。校验文件中的真实值不记录在仓库或本文。

这只证明脚本语法、Compose 配置结构和容器查询前置校验，没有执行：

- preflight 后的容器健康查询、真实 VPS 发布、健康门禁和镜像回滚；
- PostgreSQL 备份、隔离库恢复和灾难恢复切换；
- Worker 租约自然过期后的接管；
- Nginx 公网 SSE、真实账户 cookie 和真实任务的部署演练。

## 未运行事项与完成判定

本次不运行且不能写成已通过的事项包括：

- `pnpm check` 及其 format、lint、typecheck、architecture、完整测试和 build；
- 其他全量质量门禁与 GitHub workflows（workflows 保持 `disabled_manually`）；
- 真实知乎搜索成功、知乎直答成功、真实生成成功和生产精选审核；
- 真实 VPS 部署、备份恢复、租约接管、回滚和公网 SSE 演练。

因此，Issue #14 仍为“正在实施/验收证据未齐”，不是已完成、已上线或全量门禁通过。