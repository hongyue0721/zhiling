#!/usr/bin/env bash
set -Eeuo pipefail

readonly SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPOSITORY_ROOT="$(cd -- "${SCRIPT_DIRECTORY}/.." && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIRECTORY}/lib/production.sh"

PRODUCTION_ENV_FILE="${PRODUCTION_ENV_FILE:-/etc/zhijing/production.env}"
PRODUCTION_COMPOSE_FILE="${PRODUCTION_COMPOSE_FILE:-${REPOSITORY_ROOT}/compose.production.yaml}"
task_id=""

usage() {
  cat <<'USAGE'
用法：worker-lease-health.sh [--env-file PATH] [--task-id TASK_ID]

根据 env 文件中的 ZHIJING_ENVIRONMENT 检查 production 或 staging 中运行的
generation-worker 与 PostgreSQL generation_task 的真实租约；两者分别要求
zhijing-production/zhijing-postgres-production 或
zhijing-staging/zhijing-postgres-staging 三元组，错配会 fail closed。
指定 --task-id 时要求该任务是活动状态、lease_owner 非空、lease 未过期且
heartbeat 不超过 60 秒；不指定任务时只汇总所有活动租约。没有活动任务
会返回 2（indeterminate），而不是伪造 Worker 租约健康。
USAGE
}

while (($# > 0)); do
  case "$1" in
    --env-file)
      (($# >= 2)) || production_die '--env-file 需要路径。'
      PRODUCTION_ENV_FILE="$2"
      shift 2
      ;;
    --task-id)
      (($# >= 2)) || production_die '--task-id 需要任务 ID。'
      task_id="$2"
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
PRODUCTION_ENV_FILE="$env_file"
PRODUCTION_COMPOSE_FILE="$compose_file"
production_preflight "${ZHIJING_ENVIRONMENT:-}"
production_compose config --quiet

worker_container_id="$(production_container_id generation-worker)"
worker_state="$(docker inspect --format '{{.State.Status}}' "$worker_container_id")"
[[ "$worker_state" == 'running' ]] ||
  production_die "generation-worker 未运行（当前状态：${worker_state}）。"

production_compose exec -T postgres psql \
  --no-psqlrc \
  --username="$POSTGRES_USER" \
  --dbname="$DATABASE_URL" \
  --set=ON_ERROR_STOP=1 \
  --command='SELECT 1;' >/dev/null

if [[ -n "$task_id" ]]; then
  [[ "$task_id" =~ ^[A-Za-z0-9_.:-]+$ ]] || production_die '--task-id 含有不允许的字符。'
  task_fact="$(production_compose exec -T postgres psql \
    --no-psqlrc \
    --username="$POSTGRES_USER" \
    --dbname="$DATABASE_URL" \
    --set=ON_ERROR_STOP=1 \
    --tuples-only \
    --no-align \
    --set="task_id=$task_id" \
    --command="SELECT status::text || '|' || coalesce(lease_owner, '') || '|' || coalesce(extract(epoch FROM (lease_expires_at - now()))::bigint::text, '') || '|' || coalesce(extract(epoch FROM (now() - heartbeat_at))::bigint::text, '') FROM generation_task WHERE id = :'task_id';" | tr -d '\r')"
  [[ -n "$task_fact" ]] || production_die '找不到指定 generation_task；拒绝把未知任务当作健康证明。'
  IFS='|' read -r task_status lease_owner lease_seconds heartbeat_age <<< "$task_fact"
  [[ "$task_status" != 'succeeded' && "$task_status" != 'failed' ]] ||
    production_die '指定任务已是终态；没有活动租约可供证明。'
  [[ -n "$lease_owner" && "$lease_seconds" =~ ^[0-9]+$ && "$lease_seconds" -gt 0 ]] ||
    production_die '指定任务没有有效的未过期 lease_owner/lease_expires_at。'
  [[ "$heartbeat_age" =~ ^[0-9]+$ && "$heartbeat_age" -le 60 ]] ||
    production_die '指定任务 heartbeat_at 已超过 60 秒或不可读。'
  printf 'Worker 租约健康：task=%s，owner=%s，剩余约 %s 秒，心跳年龄约 %s 秒。\n' \
    "$task_id" "$lease_owner" "$lease_seconds" "$heartbeat_age"
  exit 0
fi

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
(( expired_leases == 0 )) || production_die "发现 ${expired_leases} 个过期活动租约。"
(( stale_heartbeats == 0 )) || production_die "发现 ${stale_heartbeats} 个落后心跳活动租约。"

if (( active_leases == 0 )); then
  printf 'Worker 进程与数据库可达，但当前无活动 generation_task 租约；租约健康状态为 indeterminate。\n' >&2
  exit 2
fi
printf 'Worker 租约健康：活动租约=%s，过期租约=0，落后心跳=0。\n' "$active_leases"
