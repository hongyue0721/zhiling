#!/usr/bin/env bash
set -Eeuo pipefail

readonly SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPOSITORY_ROOT="$(cd -- "${SCRIPT_DIRECTORY}/.." && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIRECTORY}/lib/production.sh"

PRODUCTION_ENV_FILE="${PRODUCTION_ENV_FILE:-/etc/zhijing/production.env}"
PRODUCTION_COMPOSE_FILE="${PRODUCTION_COMPOSE_FILE:-${REPOSITORY_ROOT}/compose.production.yaml}"
task_id=""
max_wait_seconds="180"
drill_worker_id=""
drill_container_id=""
restore_worker=0

usage() {
  cat <<'USAGE'
用法：worker-lease-recovery-drill.sh [--env-file PATH] --task-id TASK_ID [--max-wait SECONDS]

这是仅限 staging 数据库的真实租约接管演练：要求任务已经由旧
Worker 持有有效 lease，停止旧 Worker，等待数据库中的 lease_expires_at
实际过期，再以新的 GENERATION_WORKER_ID 启动同一 Worker 镜像，直到该
任务出现新的 lease_owner 或新的终态。脚本不 UPDATE 任何租约字段，也不
创建任务；失败即停并尝试恢复原 Worker。必须使用独立 staging Compose
项目和 external 数据卷，并设置：
  ZHIJING_ENVIRONMENT=staging
  LEASE_DRILL_TARGET=staging
  LEASE_DRILL_CONFIRM=I_UNDERSTAND_STAGING_ONLY
  POSTGRES_VOLUME_NAME=zhijing-postgres-staging
  POSTGRES_DB 以 staging_ 或 drill_ 开头
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
    --max-wait)
      (($# >= 2)) || production_die '--max-wait 需要秒数。'
      max_wait_seconds="$2"
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

[[ -n "$task_id" ]] || { usage >&2; production_die '必须提供 --task-id。'; }
[[ "$task_id" =~ ^[A-Za-z0-9_.:-]+$ ]] || production_die '--task-id 含有不允许的字符。'
[[ "$max_wait_seconds" =~ ^[1-9][0-9]{0,3}$ ]] || production_die '--max-wait 必须是 1 至 9999 的整数。'

# The same Compose file serves staging and production, but this entrypoint is
# staging-only; production_preflight validates the identity triple.

# Preserve the operator-selected paths across sourcing the env file.
env_file="$PRODUCTION_ENV_FILE"
compose_file="$PRODUCTION_COMPOSE_FILE"
production_load_env_file "$env_file"
PRODUCTION_ENV_FILE="$env_file"
PRODUCTION_COMPOSE_FILE="$compose_file"
production_require_env LEASE_DRILL_TARGET LEASE_DRILL_CONFIRM
[[ "$LEASE_DRILL_TARGET" == 'staging' ]] || production_die '租约演练只允许 LEASE_DRILL_TARGET=staging。'
[[ "$LEASE_DRILL_CONFIRM" == 'I_UNDERSTAND_STAGING_ONLY' ]] ||
  production_die '必须明确确认只在 staging 数据库演练。'
[[ "${POSTGRES_DB:-}" == staging_* || "${POSTGRES_DB:-}" == drill_* ]] ||
  production_die '拒绝在非 staging_/drill_ 数据库执行租约演练。'
production_preflight staging
production_require_commands date sleep tr rm
production_compose config --quiet

postgres_container_id="$(production_container_id postgres)"
postgres_volume_name="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}' "$postgres_container_id")"
[[ "$postgres_volume_name" == "$POSTGRES_VOLUME_NAME" ]] ||
  production_die "staging PostgreSQL 未挂载配置的隔离卷 ${POSTGRES_VOLUME_NAME}；拒绝演练。"

worker_container_id="$(production_container_id generation-worker)"
worker_state="$(docker inspect --format '{{.State.Status}}' "$worker_container_id")"
[[ "$worker_state" == 'running' ]] || production_die '旧 generation-worker 未运行，无法进行接管演练。'
cleanup_status=0
cleanup_resources() {
  local status="$1"
  local drill_state restored_worker_id restored_worker_state

  if [[ -n "$drill_container_id" ]]; then
    if ! docker inspect "$drill_container_id" >/dev/null 2>&1; then
      printf '清理临时 Worker 容器失败：找不到 %s。\n' "$drill_container_id" >&2
      status=1
    else
      if ! drill_state="$(docker inspect --format '{{.State.Status}}' "$drill_container_id" 2>/dev/null)"; then
        printf '无法确认临时 Worker 容器状态：%s。\n' "$drill_container_id" >&2
        status=1
      else
        case "$drill_state" in
          running|created|restarting)
            if ! docker stop "$drill_container_id" >/dev/null 2>&1; then
              printf '停止临时 Worker 容器失败：%s。\n' "$drill_container_id" >&2
              status=1
            fi
            ;;
          exited|dead)
            ;;
          *)
            printf '无法确认临时 Worker 容器状态：%s。\n' "$drill_container_id" >&2
            status=1
            ;;
        esac
      fi
      if ! docker rm "$drill_container_id" >/dev/null 2>&1; then
        printf '删除临时 Worker 容器失败：%s。\n' "$drill_container_id" >&2
        status=1
      fi
    fi
  fi

  if (( restore_worker == 1 )); then
    if ! production_compose up -d --no-deps generation-worker >/dev/null; then
      printf '恢复原 generation-worker 失败；请人工启动该服务。\n' >&2
      status=1
    elif ! restored_worker_id="$(production_container_id generation-worker 2>/dev/null)"; then
      printf '恢复原 generation-worker 后找不到容器。\n' >&2
      status=1
    else
      if ! restored_worker_state="$(docker inspect --format '{{.State.Status}}' "$restored_worker_id" 2>/dev/null)"; then
        printf '恢复原 generation-worker 后无法确认容器状态。\n' >&2
        status=1
      elif [[ "$restored_worker_id" != "$worker_container_id" || "$restored_worker_state" != 'running' ]]; then
        printf '恢复后的 generation-worker 不是原容器或未运行（容器=%s，状态=%s）。\n' \
          "$restored_worker_id" "$restored_worker_state" >&2
        status=1
      fi
    fi
  fi

  cleanup_status="$status"
}

cleanup_on_exit() {
  local status=$?
  trap - EXIT
  cleanup_resources "$status"
  exit "$cleanup_status"
}
trap cleanup_on_exit EXIT


read_task_fact() {
  production_compose exec -T postgres psql \
    --no-psqlrc \
    --username="$POSTGRES_USER" \
    --dbname="$DATABASE_URL" \
    --set=ON_ERROR_STOP=1 \
    --tuples-only \
    --no-align \
    --set="task_id=$task_id" \
    --command="SELECT status::text || '|' || coalesce(lease_owner, '') || '|' || coalesce(extract(epoch FROM (lease_expires_at - now()))::bigint::text, '') || '|' || extract(epoch FROM updated_at)::bigint::text FROM generation_task WHERE id = :'task_id;" | tr -d '\r'
}

initial_fact="$(read_task_fact)"
[[ -n "$initial_fact" ]] || production_die '找不到演练任务；不会创建假任务。'
IFS='|' read -r initial_status initial_owner initial_lease_seconds initial_updated_epoch <<< "$initial_fact"
[[ "$initial_status" != 'succeeded' && "$initial_status" != 'failed' ]] ||
  production_die '演练任务已是终态；需要一个真实的活动任务。'
[[ -n "$initial_owner" && "$initial_lease_seconds" =~ ^[0-9]+$ && "$initial_lease_seconds" -gt 0 ]] ||
  production_die '演练任务没有有效的 lease_owner/lease_expires_at。'
[[ "$initial_owner" == "${GENERATION_WORKER_ID}" ]] ||
  production_die "任务 owner=${initial_owner} 不是当前 generation-worker；拒绝停止错误的 Worker。"

# Every drill worker identity is unique for this run. A caller-provided ID is
# accepted only when no active task currently uses it; the generated fallback
# includes nanoseconds and the shell PID to prevent same-second reuse.
drill_worker_id="${LEASE_DRILL_WORKER_ID:-lease-drill-$(date -u +%Y%m%dT%H%M%S%N)-$$}"
[[ "$drill_worker_id" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || production_die 'LEASE_DRILL_WORKER_ID 含有不允许的字符。'
[[ "$drill_worker_id" != "$initial_owner" ]] || production_die '新的演练 Worker ID 必须不同于旧 owner。'
existing_worker_lease="$(production_compose exec -T postgres psql \
  --no-psqlrc \
  --username="$POSTGRES_USER" \
  --dbname="$DATABASE_URL" \
  --set=ON_ERROR_STOP=1 \
  --tuples-only \
  --no-align \
  --set="worker_id=$drill_worker_id" \
  --command="SELECT 1 FROM generation_task WHERE lease_owner = :'worker_id' AND status NOT IN ('succeeded', 'failed') LIMIT 1;" | tr -d '\r')"
[[ -z "$existing_worker_lease" ]] ||
  production_die "演练 Worker ID 已被活动任务使用，拒绝复用：${drill_worker_id}"
drill_container_name="${COMPOSE_PROJECT_NAME}-${drill_worker_id}"
if docker inspect "$drill_container_name" >/dev/null 2>&1; then
  production_die "已有同名演练容器：${drill_container_name}；拒绝覆盖。"
fi

restore_worker=1
production_compose stop generation-worker
stopped_at="$(date +%s)"


# Do not edit lease_expires_at to simulate a failure. Wait for the actual
# database lease clock to pass it, preserving the production code path.
elapsed=0
while (( elapsed < max_wait_seconds )); do
  current_fact="$(read_task_fact)"
  [[ -n "$current_fact" ]] || production_die '租约等待期间任务消失。'
  IFS='|' read -r current_status current_owner current_lease_seconds current_updated_epoch <<< "$current_fact"
  [[ "$current_status" != 'succeeded' && "$current_status" != 'failed' ]] ||
    production_die '旧 Worker 停止前任务已完成，演练无效。'
  [[ "$current_lease_seconds" =~ ^-?[0-9]+$ ]] || production_die '无法读取任务租约剩余时间。'
  (( current_lease_seconds <= 0 )) && break
  sleep 2
  elapsed=$((elapsed + 2))
done
(( elapsed < max_wait_seconds )) || production_die '等待真实租约过期超时。'

# Use a one-off container with a distinct owner so the takeover is observable
# in generation_task. It still runs the real worker binary and provider config.
drill_started_at="$(date +%s)"
drill_container_id="$(production_compose run --detach --no-deps --name "$drill_container_name" --env "GENERATION_WORKER_ID=$drill_worker_id" generation-worker)"
if ! production_wait_for_running "$drill_container_id" 30; then
  production_die '临时演练 Worker 未在 30 秒内进入 running。'
fi

takeover_proven=0
drill_lease_seen=0
elapsed=0
while (( elapsed < max_wait_seconds )); do
  current_fact="$(read_task_fact)"
  [[ -n "$current_fact" ]] || production_die '接管等待期间任务消失。'
  IFS='|' read -r current_status current_owner current_lease_seconds current_updated_epoch <<< "$current_fact"
  if [[ "$current_owner" == "$drill_worker_id" &&
    "$current_lease_seconds" =~ ^[0-9]+$ && "$current_lease_seconds" -gt 0 &&
    "$current_updated_epoch" =~ ^[0-9]+$ && "$current_updated_epoch" -ge "$drill_started_at" ]]; then
    # A persisted lease owned by this exact temporary Worker is the only
    # acceptable direct takeover proof.
    drill_lease_seen=1
    takeover_proven=1
    break
  fi
  # Terminal rows clear lease_owner, so accept a terminal result only after a
  # prior poll observed this temporary Worker owning the lease.
  if (( drill_lease_seen == 1 )) &&
    [[ "$current_status" == 'succeeded' || "$current_status" == 'failed' ]] &&
    [[ "$current_updated_epoch" =~ ^[0-9]+$ && "$current_updated_epoch" -ge "$stopped_at" ]]; then
    takeover_proven=1
    break
  fi
  sleep 2
  elapsed=$((elapsed + 2))
done
(( takeover_proven == 1 )) || production_die '演练 Worker 未在时限内取得绑定自身的新租约或产生终态。'

trap - EXIT
cleanup_resources 0
(( cleanup_status == 0 )) ||
  production_die '租约演练清理或原 Worker 恢复失败；拒绝宣称演练成功。'

printf 'Worker 租约接管演练通过：task=%s，旧 owner=%s，临时 Worker=%s 已由 generation_task 持久事实确认并完成清理。\n' \
  "$task_id" "$initial_owner" "$drill_worker_id"
