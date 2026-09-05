# 生成 Worker 部署

一期 Worker 与 Next.js Web 使用同一个仓库和 Docker 镜像，在独立进程中运行，共享 PostgreSQL。Worker 是唯一调用知乎搜索和知乎直答模型的进程；Web 不需要读取 `ZHIHU_ACCESS_SECRET`，精选地图读取因此不依赖供应方密钥。

## Docker Compose

`compose.yaml` 提供 `web`、`generation-worker`、`postgres` 和 `postgres-test` 服务：

- `web` 执行 `pnpm start`，监听 `3000`；
- `generation-worker` 执行 `pnpm worker:generation`；
- 两个应用服务都构建为 `zhijing:local`，并等待 PostgreSQL 健康检查通过；
- `postgres` 使用命名卷 `zhijing-postgres:/var/lib/postgresql/data`，生产环境必须纳入备份和恢复演练；
- Worker 使用 `restart: unless-stopped`、`init: true` 和 30 秒停止宽限期，接收 `SIGTERM`/`SIGINT` 后结束当前轮询并关闭数据库池；
- `GENERATION_WORKER_ID` 默认是稳定的 `generation-worker-1`，多 Worker 部署必须为每个实例配置不同的固定值。租约和并发锁由 PostgreSQL 负责，进程本身不实现锁。

启动前在部署环境设置：

```text
DATABASE_URL=postgresql://...
BETTER_AUTH_SECRET=至少 32 字符
BETTER_AUTH_URL=https://example.com
BETTER_AUTH_TRUSTED_ORIGINS=https://example.com
BETTER_AUTH_TRUSTED_PROXIES=...
EMAIL_VERIFICATION_ENABLED=true
# 仅在 EMAIL_VERIFICATION_ENABLED=true 时需要：
RESEND_API_KEY=...
AUTH_EMAIL_FROM=...
ZHIHU_ACCESS_SECRET=...
ZHIHU_MODEL=zhida-thinking-1p5
ZHIHU_SOURCE_TIMEOUT_MS=30000
ZHIHU_MODEL_TIMEOUT_MS=60000
GENERATION_WORKER_ID=generation-worker-1
```

`EMAIL_VERIFICATION_ENABLED` 必须显式使用 `true` 或 `false`。启用时 Web 需要
真实 Resend 配置；关闭时 Web 不初始化邮件发送器，用户可以直接登录但正式身份
保留 `emailVerified=false`。这项策略不影响 Worker 的知乎凭据要求。

`ZHIHU_MODEL` 只接受冻结的 `zhida-thinking-1p5`。Worker 启动会严格校验 Access Secret、模型和超时配置；缺失或错误配置会使进程安全失败，不会把密钥写入日志、数据库、HTTP 或 SSE。Web 组合根只读取静态适配器版本，因而不会因 Worker 密钥缺失而阻断精选接口。

构建并启动应用服务：

```bash
docker compose build web generation-worker
docker compose up -d postgres web generation-worker
```

数据库迁移仍由受控发布步骤执行，不能把迁移自动塞进 Web 或 Worker 启动命令。发布前确认 PostgreSQL 命名卷、备份和恢复演练均可用。

## 反向代理与 SSE

生成进度端点是 `/api/map-generations/{taskId}/events`。反向代理必须关闭响应缓冲，并保留长连接。例如 Nginx location 至少包含：

```nginx
location /api/map-generations/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
    proxy_send_timeout 1h;
    add_header X-Accel-Buffering no always;
}
```

Web 端点会返回 `Cache-Control: private, no-cache, no-transform` 和 `X-Accel-Buffering: no`。代理不得把事件流写入共享缓存，也不得压缩、聚合或延迟 `id`/`event`/`data` 记录。客户端使用 `Last-Event-ID` 按持久化序号恢复；历史不可用时服务端先发完整快照。

## 运行与停机

Worker 每轮调用公开的 `runOnce(workerId)`。没有可领取任务时执行有界等待，避免忙等；租约有效期、心跳和任务十分钟硬时限由地图生成模块实现。容器编排重启 Worker 不会转移进程内状态，新的 Worker 会通过 PostgreSQL 失效租约接管任务。

排障时只查看任务 ID、阶段、耗时、重试次数和稳定失败分类。不要记录 Access Secret、第三方响应正文、候选节点或其他账户身份。在线知乎/模型采样依赖真实部署密钥；仓库脱敏 fixture 仅用于适配器契约，不代表在线采样已经完成。

## 来源搜索诊断日志

Worker 为每次知乎来源搜索按顺序输出 `started`、`response` 以及
`succeeded` 或 `failed` 事件，每行都是一条 JSON 日志。事件包含任务请求 ID、
查询指纹与长度、请求数量和超时、HTTP 状态、响应 Content-Type、响应体长度、
JSON 状态、顶层字段/数据字段、来源条目字段集合、来源枚举值、知乎业务码、
失败阶段和稳定错误分类；不会写入原始查询、来源标题/正文/URL、Access Secret
或其他响应正文。

生产 Worker 日志筛选示例：

```bash
docker logs --since 30m zhijing-production-generation-worker-1 2>&1 \
  | jq -R 'fromjson? | select(type == "object" and ((.event // "") | startswith("zhihu_source_search_")))'
```

`response` 事件用于区分 HTTP、JSON 信封、业务码、数据字段和来源枚举问题；
`failed` 事件中的 `requestId`、`queryFingerprint` 与 `failurePhase` 可和地图生成
任务日志关联。日志收集器故障不会改变来源搜索的成功或失败结果。

## VPS 生产与 staging 入口

生产和 staging 都使用仓库根目录的 `compose.production.yaml`；不要把本页
前面的本地 `compose.yaml` 叠加。入口通过三元组严格选择隔离集群：

| 环境                  | `ZHIJING_ENVIRONMENT` | `COMPOSE_PROJECT_NAME` | `POSTGRES_VOLUME_NAME`        |
| --------------------- | --------------------- | ---------------------- | ----------------------------- |
| production            | `production`          | `zhijing-production`   | `zhijing-postgres-production` |
| staging（仅租约演练） | `staging`             | `zhijing-staging`      | `zhijing-postgres-staging`    |

两套卷都必须预先创建为 external volume；项目名、卷名、环境名和
`DATABASE_URL`（必须指向 `postgres:5432` 与对应 `POSTGRES_DB`）任一错配
都会 fail closed。Web 端口固定为 `WEB_BIND_PORT=3000`，并与
[`ops/nginx/zhijing.conf`](../../ops/nginx/zhijing.conf) 的 loopback upstream
保持单一事实源。生产 env 还必须提供
`GENERATION_RATE_LIMIT_WINDOW_SECONDS` 和
`GENERATION_RATE_LIMIT_MAX_REQUESTS` 两个正整数。
