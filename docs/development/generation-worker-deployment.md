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
RESEND_API_KEY=...
AUTH_EMAIL_FROM=...
ZHIHU_ACCESS_SECRET=...
ZHIHU_MODEL=zhida-thinking-1p5
ZHIHU_SOURCE_TIMEOUT_MS=30000
ZHIHU_MODEL_TIMEOUT_MS=60000
GENERATION_WORKER_ID=generation-worker-1
```

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
