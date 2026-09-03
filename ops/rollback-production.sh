#!/usr/bin/env bash
set -Eeuo pipefail

readonly SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPOSITORY_ROOT="$(cd -- "${SCRIPT_DIRECTORY}/.." && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIRECTORY}/lib/production.sh"

PRODUCTION_ENV_FILE="${PRODUCTION_ENV_FILE:-/etc/zhijing/production.env}"
PRODUCTION_COMPOSE_FILE="${PRODUCTION_COMPOSE_FILE:-${REPOSITORY_ROOT}/compose.production.yaml}"
previous_image_tag=""

usage() {
  cat <<'USAGE'
用法：rollback-production.sh --previous-tag 40位提交SHA [--env-file PATH]

该脚本只替换 Web/Worker 的不可变镜像并复用现有数据库。它绝不会执行
DROP DATABASE、pg_restore、drizzle-kit 回退或任何数据库迁移回滚。由于
迁移可能不可逆，旧镜像能否兼容当前 schema 必须由发布人确认。
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
    --database-rollback|--rollback-database)
      production_die '拒绝数据库自动回滚；请使用经过审批的隔离恢复演练与人工迁移方案。'
      ;;
    *)
      production_die "未知参数：$1"
      ;;
  esac
done
production_acquire_release_lock

env_file="$PRODUCTION_ENV_FILE"
compose_file="$PRODUCTION_COMPOSE_FILE"
production_load_env_file "$env_file"
PRODUCTION_ENV_FILE="$env_file"
PRODUCTION_COMPOSE_FILE="$compose_file"

[[ -n "$previous_image_tag" ]] || production_die '必须显式提供 --previous-tag。'
current_image_tag="$IMAGE_TAG"
[[ "$previous_image_tag" != "$current_image_tag" ]] ||
  production_die 'previous tag 不得与当前 IMAGE_TAG 相同。'
# The target tag is a command-line release decision, never a mutable env-file default.
IMAGE_TAG="$previous_image_tag"
production_preflight production

printf '仅回滚 Web/Worker 到不可变镜像：%s\n' "$previous_image_tag"
printf '数据库保持原状；不会执行数据库回滚。\n'
production_compose pull web generation-worker
# --no-deps is intentional: the migration service and PostgreSQL are not
# restarted or changed during an application-only rollback.
production_compose up -d --no-deps web generation-worker

web_id="$(production_container_id web)"
if ! production_wait_for_health "$web_id" 180; then
  production_die 'Web 未在 180 秒内进入 healthy；回滚失败且不会宣称健康。'
fi
worker_id="$(production_container_id generation-worker)"
if ! production_wait_for_running "$worker_id" 120; then
  production_die 'generation-worker 未在 120 秒内进入 running；回滚失败。'
fi

if PRODUCTION_RELEASE_LOCK_HELD=1 PRODUCTION_COMPOSE_FILE="$PRODUCTION_COMPOSE_FILE" "$SCRIPT_DIRECTORY/production-healthcheck.sh" \
  --env-file "$PRODUCTION_ENV_FILE" \
  --image-tag "$previous_image_tag"; then
  printf '应用回滚健康检查通过：%s\n' "$previous_image_tag"
else
  printf '应用回滚健康检查失败：%s；数据库仍未回滚，必须人工接管。\n' "$previous_image_tag" >&2
  exit 1
fi
