#!/usr/bin/env bash
set -Eeuo pipefail

readonly SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPOSITORY_ROOT="$(cd -- "${SCRIPT_DIRECTORY}/.." && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIRECTORY}/lib/production.sh"

PRODUCTION_ENV_FILE="${PRODUCTION_ENV_FILE:-/etc/zhijing/production.env}"
PRODUCTION_COMPOSE_FILE="${PRODUCTION_COMPOSE_FILE:-${REPOSITORY_ROOT}/compose.production.yaml}"
previous_image_tag="${PREVIOUS_IMAGE_TAG:-}"

usage() {
  cat <<'USAGE'
用法：
  deploy-production.sh [--env-file PATH] [--previous-tag 40位提交SHA]

说明：
  该入口只拉取不可变提交 SHA 镜像，先启动 PostgreSQL 并等待健康检查，
  再执行一次性 Drizzle 迁移，迁移成功后才启动 Web/Worker。迁移失败时
  立即停止发布且不执行数据库回滚。提供 --previous-tag 后，Web/Worker
  健康检查失败会只回滚应用镜像；数据库迁移永远不会自动回滚。
USAGE
}

while (($# > 0)); do
  case "$1" in
    --env-file)
      (($# >= 2)) || production_die '--env-file 需要路径。'
      PRODUCTION_ENV_FILE="$2"
      shift 2
      ;;
    --previous-tag)
      (($# >= 2)) || production_die '--previous-tag 需要提交 SHA。'
      previous_image_tag="$2"
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
production_acquire_release_lock

env_file="$PRODUCTION_ENV_FILE"
production_load_env_file "$env_file"

PRODUCTION_ENV_FILE="$env_file"
# This internal marker is set after loading the operator file so a malicious
# value in that file cannot make the nested rollback skip lock acquisition.
PRODUCTION_RELEASE_LOCK_HELD=1
export PRODUCTION_RELEASE_LOCK_HELD
production_preflight production

if [[ -n "$previous_image_tag" ]]; then
  production_validate_image_tag "$previous_image_tag"
  [[ "$previous_image_tag" != "$IMAGE_TAG" ]] ||
    production_die 'previous tag 不得与当前 IMAGE_TAG 相同。'
fi

# config --quiet evaluates every required ${VAR:?} before any container starts.
production_compose config --quiet
production_compose pull migrate web generation-worker
production_compose up -d postgres

postgres_id="$(production_container_id postgres)"
if ! production_wait_for_health "$postgres_id" 180; then
  production_die 'PostgreSQL 未在 180 秒内进入 healthy；Web/Worker 尚未启动。'
fi

# Keep the migration container (do not use run --rm), so service_completed_successfully
# remains an enforceable dependency for both application services.
production_compose up -d migrate
migration_id="$(production_container_id_all migrate)"
if ! production_wait_for_exit "$migration_id" 900; then
  migration_state="$(docker inspect --format '{{.State.Status}}' "$migration_id" 2>/dev/null || printf 'unknown')"
  if [[ "$migration_state" == 'running' ]]; then
    docker stop --time 30 "$migration_id" >/dev/null 2>&1 || true
  fi
  migration_exit_code="$(docker inspect --format '{{.State.ExitCode}}' "$migration_id" 2>/dev/null || printf 'unknown')"
  printf '数据库迁移失败或超时（退出码：%s）；未启动新的 Web/Worker，且没有自动数据库回滚。\n' "$migration_exit_code" >&2
  exit 1
fi
production_compose up -d web generation-worker

web_id="$(production_container_id web)"
if ! production_wait_for_health "$web_id" 180; then
  production_die 'Web 未在 180 秒内进入 healthy；发布失败且不会宣称健康。'
fi
worker_id="$(production_container_id generation-worker)"
if ! production_wait_for_running "$worker_id" 120; then
  production_die 'generation-worker 未在 120 秒内进入 running；发布失败。'
fi

if PRODUCTION_RELEASE_LOCK_HELD=1 PRODUCTION_COMPOSE_FILE="$PRODUCTION_COMPOSE_FILE" "$SCRIPT_DIRECTORY/production-healthcheck.sh" --env-file "$PRODUCTION_ENV_FILE"; then
  printf '生产发布成功：%s\n' "$IMAGE_TAG"
  exit 0
fi

printf '新镜像健康检查失败：%s\n' "$IMAGE_TAG" >&2
if [[ -z "$previous_image_tag" ]]; then
  printf '未提供 --previous-tag；保持数据库不变并保留失败版本，需人工执行应用回滚。\n' >&2
  exit 1
fi

printf '开始仅回滚 Web/Worker 镜像到：%s（不回滚数据库）\n' "$previous_image_tag" >&2
if PRODUCTION_RELEASE_LOCK_HELD=1 PRODUCTION_COMPOSE_FILE="$PRODUCTION_COMPOSE_FILE" "$SCRIPT_DIRECTORY/rollback-production.sh" \
  --env-file "$PRODUCTION_ENV_FILE" \
  --previous-tag "$previous_image_tag"; then
  printf '应用回滚完成；数据库迁移未回滚，请确认旧镜像兼容当前 schema。\n' >&2
else
  printf '应用回滚也未通过健康检查；数据库仍未回滚，必须人工接管。\n' >&2
fi
exit 1
