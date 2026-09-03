# 生产发布与恢复运维

本页是 VPS Docker 的生产入口。生产环境**只能**使用仓库根目录的
`compose.production.yaml`，不能把本地开发用的 `compose.yaml` 叠加到生产
项目；后者保留本地数据库口令和公网开发端口。该 Compose 文件也可用于
隔离 staging，但必须使用本页规定的环境、项目和 external volume 三元组。
所有命令都在仓库 checkout 中执行，应用镜像由提交 SHA 固定。

## 0. 网络与主机边界

- 防火墙只开放 SSH、80 和 443；禁止开放 5432。PostgreSQL 在
  `compose.production.yaml` 中没有 `ports`，只通过 Compose 私有网络供
  `migrate`、`web` 和 `generation-worker` 使用。
- Web 只绑定到 `127.0.0.1:3000`，生产预检强制 `WEB_BIND_PORT=3000`，
  公网请求必须经过本机 Nginx。不要把这个端口改成 `0.0.0.0`；Nginx 配置见
  [`ops/nginx/zhijing.conf`](../../ops/nginx/zhijing.conf)。
- 运维健康检查脚本加载 env 文件后，会把其中的
  `ZHIJING_ENVIRONMENT` 显式传给 `production_preflight`；只接受以下两组
  严格三元组。环境名、Compose 项目名或 external volume 名任一错配，都会
  在容器启动或健康检查前 fail closed：
  - production：`ZHIJING_ENVIRONMENT=production`、
    `COMPOSE_PROJECT_NAME=zhijing-production`、
    `POSTGRES_VOLUME_NAME=zhijing-postgres-production`
  - staging：`ZHIJING_ENVIRONMENT=staging`、
    `COMPOSE_PROJECT_NAME=zhijing-staging`、
    `POSTGRES_VOLUME_NAME=zhijing-postgres-staging`
- VPS 安装 Docker Engine 与 Docker Compose v2，并让部署用户加入 docker
  组或使用 root。Registry 必须开启不可变 tag（同一个 tag 拒绝第二次
  push），备份目录应位于独立磁盘或已验证的远端同步目标。
- `ZHIHU_ACCESS_SECRET` 只存在于 Worker 的容器环境；`web` 与 `migrate`
  服务没有该变量。`.dockerignore` 排除全部 `.env*` 文件，生产 env 文件
  不得进入 Git、Docker build context、镜像、日志或工单。

## 1. 严格环境文件

以 root 或专用部署用户创建 `/etc/zhijing/production.env`，权限必须是
`0600`，然后填写下面所有变量。脚本不提供生产口令、空密钥或 `latest`
默认值，变量缺失、占位值、弱口令和不安全的 origin 都会在容器启动前
失败。

```dotenv
ZHIJING_ENVIRONMENT=production
COMPOSE_PROJECT_NAME=zhijing-production
POSTGRES_VOLUME_NAME=zhijing-postgres-production
IMAGE_REPOSITORY=registry.example.invalid/team/zhijing
IMAGE_TAG='<40位小写提交SHA>'
POSTGRES_DB='<生产数据库名>'
POSTGRES_USER='<生产数据库用户>'
POSTGRES_PASSWORD='<至少24字符的真实口令>'
DATABASE_URL='postgresql://<用户>:<URL编码后的口令>@postgres:5432/<数据库名>'
WEB_BIND_PORT=3000
BETTER_AUTH_SECRET='<至少32字符的随机值>'
BETTER_AUTH_URL=https://learn.example.com
BETTER_AUTH_TRUSTED_ORIGINS=https://learn.example.com
BETTER_AUTH_TRUSTED_PROXIES='<Nginx连接进入容器的实际IP或CIDR>'
RESEND_API_KEY='<真实Resend密钥>'
AUTH_EMAIL_FROM='知径 <auth@example.com>'
GENERATION_RATE_LIMIT_WINDOW_SECONDS=60
GENERATION_RATE_LIMIT_MAX_REQUESTS=30
GENERATION_WORKER_ID=generation-worker-1
ZHIHU_ACCESS_SECRET='<真实知乎开放平台Access Secret>'
ZHIHU_MODEL=zhida-thinking-1p5
ZHIHU_SOURCE_TIMEOUT_MS=30000
ZHIHU_MODEL_TIMEOUT_MS=60000
```

`<...>` 只是字段说明，不能原样保存。用密码管理器生成随机值，例如：

```bash
openssl rand -base64 36
openssl rand -base64 48
```

`DATABASE_URL` 必须严格使用 Compose 服务名 `postgres`、端口 `5432`、
配置的 `POSTGRES_USER` 和 `POSTGRES_DB`；公网主机、回环地址、其他服务名
或错库会在启动前拒绝。密码必须按 URL 规则编码，并与初始化 PostgreSQL
时的 `POSTGRES_PASSWORD` 对应；已有数据卷不会因为修改环境变量自动更改
角色口令，轮换口令必须走单独审批的 SQL 变更。`BETTER_AUTH_TRUSTED_PROXIES`
只能填写实际代理地址，不能填写 `0.0.0.0/0`；可在 Nginx 与 Compose 网络
稳定后由运维根据 `docker network inspect` 确认。

首次部署前一次性创建固定 external volume 与发布锁（不要让 Compose
按项目名隐式创建卷）：

```bash
sudo docker volume create --name zhijing-postgres-production
sudo install -o <deploy-user> -g <deploy-user> -m 600 /dev/null \
  /run/lock/zhijing-production-release.lock
```

`deploy-production.sh` 与 `rollback-production.sh` 共享该全局 `flock`，
并发发布会等待前一个流程结束；发布失败触发的应用回滚会继承同一把锁，
不会与另一条发布交错。

加载 env 文件时不要把它打印到终端：

```bash
sudo install -d -m 700 /etc/zhijing
sudo install -m 600 /dev/null /etc/zhijing/production.env
sudo chown <deploy-user>:<deploy-user> /etc/zhijing/production.env
sudo chmod 600 /etc/zhijing/production.env
```

脚本自身会再次检查文件权限、所有者、所有必需变量、HTTPS origin、数据库
URL、Worker 模型和超时上限。

单独预检而不启动容器：

```bash
bash ops/preflight-production.sh --env-file /etc/zhijing/production.env
```

## 2. 构建、推送与发布

在已审查的 commit checkout 构建和推送，不向 Docker build 传入数据库或
任何服务端密钥。`ops/publish-image.sh` 默认读取当前 commit 的完整 SHA，
并在 Registry 已存在同名 tag 时拒绝覆盖；生产 Registry 仍必须启用不可变
tag 策略。

```bash
export IMAGE_REPOSITORY=registry.example.invalid/team/zhijing
docker login registry.example.invalid
bash ops/publish-image.sh --repository "$IMAGE_REPOSITORY" --tag "$(git rev-parse HEAD)"
```

在 VPS 上，先确认已登录同一 Registry，并准备上一版完整 SHA：

```bash
PREVIOUS_IMAGE_TAG='<上一版40位小写提交SHA>'
bash ops/deploy-production.sh \
  --env-file /etc/zhijing/production.env \
  --previous-tag "$PREVIOUS_IMAGE_TAG"
```

发布入口执行顺序是固定的：

1. 取得全局发布 `flock`；严格预检和 `docker compose config --quiet`，缺失
   值、错误环境/项目/卷或错误数据库 URL 都不会被默认值替代；
2. 拉取当前 SHA 镜像；
3. 启动 PostgreSQL，等待容器 healthcheck；
4. 启动一次性 `migrate` 服务并等待 `pnpm db:migrate` 退出码为 0；迁移
   的 fast-exit 成功终态会保留，供应用 `depends_on` 强制依赖；
5. 迁移成功后启动 Web 与 Worker，并有界等待 Web healthcheck 从 `starting`
   进入 `healthy`、Worker 进入 `running`；
6. 以实际 Next.js HTTP 请求、容器 healthcheck 和数据库租约汇总执行健康门禁。

迁移失败会立即停止发布，既不会启动新 Web/Worker，也不会猜测或执行
数据库回滚。迁移成功而应用健康门禁失败时，若提供了
`--previous-tag`，入口只回滚 Web/Worker 镜像；数据库保持迁移后的状态。
因此每次迁移都必须先确认新旧应用的兼容窗口。

单独查看门禁（脚本按加载的 env 文件中的
`ZHIJING_ENVIRONMENT` 选择 production 或 staging；空闲 Worker 不会被伪造
成“有租约健康”）：

生产环境：

```bash
bash ops/production-healthcheck.sh --env-file /etc/zhijing/production.env
bash ops/worker-lease-health.sh --env-file /etc/zhijing/production.env --task-id '<真实活动任务ID>'
```

staging 环境使用同一组检查脚本，但必须加载 staging 专用 env 文件；脚本会
按 staging 三元组检查，不能把 staging 项目或 volume 当作 production：

```bash
bash ops/production-healthcheck.sh --env-file /etc/zhijing/staging.env
bash ops/worker-lease-health.sh --env-file /etc/zhijing/staging.env --task-id '<真实活动任务ID>'
```

不提供 `--task-id` 时，Worker 租约检查若当前无活动任务会返回退出码 2
（`indeterminate`），而不是仅凭进程存在宣称任务执行健康。

## 3. PostgreSQL 备份与恢复演练

备份只读当前正在运行且 healthy 的 PostgreSQL，不会替生产服务启动/重建
数据库，也不会覆盖同名文件。它将 custom-format archive 流式写到同目录
的随机 0600 临时文件，完整成功后才 `rename` 到最终路径，随后原子发布
`.sha256` 文件，并使用容器内 `pg_restore --list` 再校验一次。

```bash
backup="/srv/zhijing/backups/zhijing-$(date -u +%Y%m%dT%H%M%SZ).dump"
bash ops/postgres-backup.sh \
  --env-file /etc/zhijing/production.env \
  "$backup"
```

把 `.dump` 和 `.sha256` 一起复制到受限的远端备份位置，保留至少一份离线
恢复演练**只能**指向事先不存在的 `restore_drill_*` 数据库。脚本先检查
checksum 和 archive，再使用配置的 `POSTGRES_USER` 执行 `createdb`、
`pg_restore` 和 `psql`，在同一 Compose PostgreSQL 集群内创建 template0
隔离库，以 `--single-transaction` 恢复并检查核心表，最后只删除这个演练库。
它拒绝 `POSTGRES_DB`、已有目标和任何不带前缀的数据库名；真实生产库永远
不是恢复目标。

```bash
bash ops/postgres-restore-drill.sh \
  --env-file /etc/zhijing/production.env \
  --target restore_drill_$(date -u +%Y%m%d%H%M%S%N)_$$ \
  "$backup"
```

如果恢复、校验或最后清理失败，命令返回非零并打印待人工处理的隔离目标；
不得为了“绿灯”对生产库执行 `DROP DATABASE`、`pg_restore --clean` 或覆盖
数据。需要真正的灾难恢复时，先把备份复制到独立 PostgreSQL 集群，再由
审批过的 runbook 指定恢复目标；上述演练脚本不是生产切换命令。

## 4. Worker 租约接管演练

生成状态事实保存在 `generation_task`：`lease_owner`、
`lease_expires_at`、`heartbeat_at` 和 `status`。健康检查只读取这些字段，
不在数据库写入假租约。接管演练也不 `UPDATE` 租约、不创建假任务，而是在
staging 数据库选择一个真实活动任务，停止旧 Worker，等待数据库时钟让租约
自然过期，再以新的 Worker ID 运行同一个 `compose.production.yaml` 中的真实
Worker 镜像。

演练环境必须使用同一个 `compose.production.yaml`，但通过三元组严格隔离：
`ZHIJING_ENVIRONMENT=staging`、`COMPOSE_PROJECT_NAME=zhijing-staging`、
`POSTGRES_VOLUME_NAME=zhijing-postgres-staging`。数据库名必须以
`staging_` 或 `drill_` 开头，`DATABASE_URL` 仍必须是
`postgresql://<用户>:<URL编码后的口令>@postgres:5432/<数据库名>`。专用
env 文件还要填写生产 env 中列出的其他必需变量（包括两个限频正整数）：

```dotenv
ZHIJING_ENVIRONMENT=staging
COMPOSE_PROJECT_NAME=zhijing-staging
POSTGRES_VOLUME_NAME=zhijing-postgres-staging
POSTGRES_DB=staging_zhijing
POSTGRES_USER='<staging数据库用户>'
POSTGRES_PASSWORD='<至少24字符的真实口令>'
DATABASE_URL='postgresql://<用户>:<URL编码后的口令>@postgres:5432/staging_zhijing'
WEB_BIND_PORT=3000
GENERATION_RATE_LIMIT_WINDOW_SECONDS=60
GENERATION_RATE_LIMIT_MAX_REQUESTS=30
LEASE_DRILL_TARGET=staging
LEASE_DRILL_CONFIRM=I_UNDERSTAND_STAGING_ONLY
LEASE_DRILL_WORKER_ID='可选；不填则由脚本用纳秒时间戳与 PID 生成'
```

首次使用 staging 时一次性创建隔离 external volume：

```bash
sudo docker volume create --name zhijing-postgres-staging
```

确认 staging 中确有真实活动任务后执行：

```bash
bash ops/worker-lease-recovery-drill.sh \
  --env-file /etc/zhijing/staging.env \
  --task-id '<真实活动generation_task.id>' \
  --max-wait 180
```

脚本失败即停，并在退出时停止临时 Worker、删除临时容器、恢复**原容器**
并验证原容器仍为 `running`；任一步 cleanup 失败都会返回非零，不会打印
可信成功。临时 Worker 必须使用真实 `pnpm worker:generation`，不能用
sleep/假健康命令。演练通过标准是数据库中先观察到
`lease_owner=<本次临时 Worker ID>` 且租约未过期；只有随后由该接管链路产生
的新终态才可作为终态证明。若没有活动任务，使用 `worker-lease-health.sh`
得到的 `indeterminate` 是预期结果。

## 5. Nginx SSE 代理与验证

安装 Nginx 配置前将 `server_name _` 替换为真实域名，并把证书路径替换为
VPS 上由 ACME/certbot 管理的真实文件；不要把证书私钥提交到仓库：

```bash
sudo install -m 644 ops/nginx/zhijing.conf /etc/nginx/sites-available/zhijing.conf
sudo ln -sfn /etc/nginx/sites-available/zhijing.conf /etc/nginx/sites-enabled/zhijing.conf
sudo nginx -t
sudo systemctl reload nginx
```

`/api/map-generations/` location 强制 HTTP/1.1、清空 Connection、传递
`Last-Event-ID`，并关闭 `proxy_buffering`/缓存/请求缓冲，设置 1 小时读写
超时和 `X-Accel-Buffering: no`。Nginx upstream 固定为
`127.0.0.1:3000`，与生产预检强制的 `WEB_BIND_PORT=3000` 是单一事实源；
不要修改其中任一端口、增加 gzip、缓存或短超时。

使用真实登录账户的 session cookie 与真实 task ID 做验证；不要把 cookie
写进 shell 历史、CI 输出或工单：

```bash
export SESSION_COOKIE='<只在当前受限终端临时设置>'
export ORIGIN='https://learn.example.com'
export TASK_ID='<真实任务ID>'

curl -sS -D - -o /dev/null \
  -H "Cookie: $SESSION_COOKIE" \
  -H 'Accept: text/event-stream' \
  -H 'Last-Event-ID: 0' \
  "$ORIGIN/api/map-generations/$TASK_ID/events"

curl --no-buffer --max-time 20 -sS \
  -H "Cookie: $SESSION_COOKIE" \
  -H 'Accept: text/event-stream' \
  -H 'Last-Event-ID: 0' \
  "$ORIGIN/api/map-generations/$TASK_ID/events"
```

第一条响应应显示 `X-Accel-Buffering: no`、私有 no-cache 语义和
`text/event-stream`；第二条应在连接保持期间逐条看到 `id`/`event`/`data`
记录，并可用更大的 `Last-Event-ID` 重连验证断线恢复。验证后立即清除
`unset SESSION_COOKIE`。如果只看到连接建立但没有事件，先查 Nginx
`proxy_read_timeout`/缓冲设置和服务端租约，不要在代理层伪造事件。

## 6. 失败处理与回滚边界

| 现象                        | 处置                                                                           |
| --------------------------- | ------------------------------------------------------------------------------ |
| env/preflight/config 失败   | 不启动容器，修正受限 env 文件后重试；环境、项目、卷和数据库 URL 必须成对匹配。 |
| PostgreSQL healthcheck 超时 | 不启动 Web/Worker；检查固定 external 卷和数据库日志。                          |
| migration 非零              | 保留现有应用，停止发布；由人工审查迁移和备份，禁止自动 down。                  |
| 新镜像 Web/Worker 健康失败  | 使用已审查的上一版 SHA 执行 `rollback-production.sh`；数据库不回滚。           |
| 回滚镜像与新 schema 不兼容  | 停止流量并人工选择兼容镜像或隔离恢复，不对生产库试错。                         |
| Worker 租约过期/心跳落后    | 先看 `generation_task` 实际字段，按 staging 演练验证接管，不 UPDATE 生产租约。 |
| SSE 代理缓冲/断线           | `nginx -t` 后修正 location，使用真实 cookie/task 重试；不扩大公开端口。        |

应用回滚命令明确拒绝数据库回滚参数，并且只使用 `--no-deps` 更新
Web/Worker：

```bash
bash ops/rollback-production.sh \
  --env-file /etc/zhijing/production.env \
  --previous-tag '<已推送且不可变的上一版SHA>'
```

数据库迁移不可逆时没有安全的自动回滚路径；备份恢复只在隔离目标反复演练
通过后，才能由单独审批的灾难恢复流程执行。任何脚本返回非零都应保留
错误证据、停止自动化链路并人工接管，而不是用默认值或假健康状态继续发布。
