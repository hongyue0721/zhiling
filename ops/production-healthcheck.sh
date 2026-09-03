#!/usr/bin/env bash
set -Eeuo pipefail

readonly SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPOSITORY_ROOT="$(cd -- "${SCRIPT_DIRECTORY}/.." && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIRECTORY}/lib/production.sh"

PRODUCTION_ENV_FILE="${PRODUCTION_ENV_FILE:-/etc/zhijing/production.env}"
PRODUCTION_COMPOSE_FILE="${PRODUCTION_COMPOSE_FILE:-${REPOSITORY_ROOT}/compose.production.yaml}"
expected_image_tag=""

usage() {
  cat <<'USAGE'
用法：production-healthcheck.sh [--env-file PATH] [--image-tag 40位提交SHA]
根据 env 文件中的 ZHIJING_ENVIRONMENT 检查真实运行状态；仅支持
production 或 staging，并分别要求对应的项目名与 external volume 三元组：
production=zhijing-production/zhijing-postgres-production，
staging=zhijing-staging/zhijing-postgres-staging。三元组错配会 fail closed。
检查真实运行状态：PostgreSQL healthcheck、已成功迁移的容器、Web HTTP
路由、Worker 进程和 generation_task 中的租约事实。没有活动任务时只
报告“空闲”，不会伪造 Worker 租约健康证明；需要证明接管能力时执行
worker-lease-recovery-drill.sh。
USAGE
}

while (($# > 0)); do
  case "$1" in
    --env-file)
      (($# >= 2)) || production_die '--env-file 需要路径。'
      PRODUCTION_ENV_FILE="$2"
      shift 2
      ;;
    --image-tag)
      (($# >= 2)) || production_die '--image-tag 需要提交 SHA。'
      expected_image_tag="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      production_die "未知参数：$1"
      ;;
  esac
done

env_file="$PRODUCTION_ENV_FILE"
compose_file="$PRODUCTION_COMPOSE_FILE"
production_load_env_file "$env_file"
if [[ -n "$expected_image_tag" ]]; then
  IMAGE_TAG="$expected_image_tag"
fi
# Command-line paths remain authoritative after sourcing operator variables.
PRODUCTION_ENV_FILE="$env_file"
PRODUCTION_COMPOSE_FILE="$compose_file"
production_preflight "${ZHIJING_ENVIRONMENT:-}"
production_compose config --quiet

postgres_id="$(production_container_id postgres)"
postgres_state="$(docker inspect --format '{{.State.Status}}' "$postgres_id")"
[[ "$postgres_state" == 'running' ]] ||
  production_die "PostgreSQL 容器未运行（当前状态：${postgres_state}）。"
postgres_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$postgres_id")"
[[ "$postgres_health" == 'healthy' ]] ||
  production_die "PostgreSQL healthcheck 未通过（状态：${postgres_health}）。"

migration_id="$(production_container_id_all migrate)"
migration_state="$(docker inspect --format '{{.State.Status}}' "$migration_id")"
migration_exit_code="$(docker inspect --format '{{.State.ExitCode}}' "$migration_id")"
[[ "$migration_state" == 'exited' && "$migration_exit_code" == '0' ]] ||
  production_die "数据库迁移容器不是成功终态（状态：${migration_state}，退出码：${migration_exit_code}）。"

expected_image="${IMAGE_REPOSITORY}:${IMAGE_TAG}"

assert_expected_image() {
  local service="$1"
  local container_id="$2"
  local actual_image
  actual_image="$(docker inspect --format '{{.Config.Image}}' "$container_id")"
  [[ "$actual_image" == "$expected_image" ]] ||
    production_die "${service} 未运行期望的不可变镜像 tag。"
}

web_id="$(production_container_id web)"
web_state="$(docker inspect --format '{{.State.Status}}' "$web_id")"
[[ "$web_state" == 'running' ]] ||
  production_die "Web 容器未运行（当前状态：${web_state}）。"
web_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$web_id")"
[[ "$web_health" == 'healthy' ]] ||
  production_die "Web healthcheck 未通过（状态：${web_health}）。"

# This reaches the real Next.js process rather than trusting container state.
assert_expected_image web "$web_id"
# The private endpoint intentionally returns 401 without a cookie; any 5xx is
# a process/configuration failure, while the request itself never logs secrets.
production_compose exec -T web node -e \
  "fetch('http://127.0.0.1:3000/api/featured-learning-maps').then((response) => process.exit(response.status < 500 ? 0 : 1)).catch(() => process.exit(1))"

worker_id="$(production_container_id generation-worker)"
worker_state="$(docker inspect --format '{{.State.Status}}' "$worker_id")"
[[ "$worker_state" == 'running' ]] ||
  production_die "generation-worker 容器未运行（当前状态：${worker_state}）。"
assert_expected_image generation-worker "$worker_id"

# Confirm the same database used by the containers is reachable and summarize
# only lease metadata. No task topic, provider payload, account ID, or answer
# is selected or printed by this check.
production_compose exec -T postgres psql \
  --no-psqlrc \
  --username="$POSTGRES_USER" \
  --dbname="$DATABASE_URL" \
  --set=ON_ERROR_STOP=1 \
  --command='SELECT 1;' >/dev/null
lease_summary="$(production_compose exec -T postgres psql \
  --no-psqlrc \
  --username="$POSTGRES_USER" \
  --dbname="$DATABASE_URL" \
  --set=ON_ERROR_STOP=1 \
  --tuples-only \
  --no-align \
  --command="SELECT count(*) FILTER (WHERE status NOT IN ('succeeded', 'failed') AND lease_owner IS NOT NULL AND lease_expires_at > now()) || '|' || count(*) FILTER (WHERE status NOT IN ('succeeded', 'failed') AND lease_expires_at IS NOT NULL AND lease_expires_at <= now()) || '|' || count(*) FILTER (WHERE status NOT IN ('succeeded', 'failed') AND lease_owner IS NOT NULL AND (heartbeat_at IS NULL OR heartbeat_at < now() - interval '60 seconds')) FROM generation_task;" | tr -d '\r')"
IFS='|' read -r active_leases expired_leases stale_heartbeats <<< "$lease_summary"
[[ "$active_leases" =~ ^[0-9]+$ && "$expired_leases" =~ ^[0-9]+$ && "$stale_heartbeats" =~ ^[0-9]+$ ]] ||
  production_die '无法读取 generation_task 租约汇总。'
(( expired_leases == 0 )) ||
  production_die "发现 ${expired_leases} 个已过期的活动租约；Worker 健康检查失败。"
(( stale_heartbeats == 0 )) ||
  production_die "发现 ${stale_heartbeats} 个心跳落后的活动租约；Worker 健康检查失败。"

if (( active_leases == 0 )); then
  printf '生产健康门禁通过：PostgreSQL/Web/Worker 正在运行；当前无活动租约，未伪造租约执行证明。\n'
else
  printf '生产健康门禁通过：PostgreSQL/Web/Worker 正在运行；活动租约=%s，过期租约=0，落后心跳=0。\n' "$active_leases"
fi
