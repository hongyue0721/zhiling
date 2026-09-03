#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPOSITORY_ROOT="$(cd -- "${SCRIPT_DIRECTORY}/.." && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIRECTORY}/lib/production.sh"

PRODUCTION_ENV_FILE="${PRODUCTION_ENV_FILE:-/etc/zhijing/production.env}"
PRODUCTION_COMPOSE_FILE="${PRODUCTION_COMPOSE_FILE:-${REPOSITORY_ROOT}/compose.production.yaml}"
backup_path=""
target_database=""

usage() {
  cat <<'USAGE'
用法：postgres-restore-drill.sh [--env-file PATH] --target restore_drill_NAME BACKUP.dump

先校验 .sha256 与 custom-format archive，再在同一 PostgreSQL 集群内创建
一个全新的 restore_drill_* 数据库并使用 --single-transaction 恢复。目标
数据库必须事先不存在，且永远不能等于 POSTGRES_DB；演练结束后仅删除这个
带 restore_drill_ 前缀的临时目标。任何校验、创建、恢复或清理失败都返回
非零，不会 DROP 当前生产数据库。
USAGE
}

while (($# > 0)); do
  case "$1" in
    --env-file)
      (($# >= 2)) || production_die '--env-file 需要路径。'
      PRODUCTION_ENV_FILE="$2"
      shift 2
      ;;
    --target)
      (($# >= 2)) || production_die '--target 需要隔离数据库名。'
      target_database="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    --)
      shift
      (($# == 1)) || production_die '必须且只能提供一个备份文件。'
      backup_path="$1"
      shift
      ;;
    -*)
      production_die "未知参数：$1"
      ;;
    *)
      [[ -z "$backup_path" ]] || production_die '必须且只能提供一个备份文件。'
      backup_path="$1"
      shift
      ;;
  esac
done

[[ -n "$backup_path" ]] || { usage >&2; production_die '必须提供备份文件。'; }
[[ -n "$target_database" ]] || { usage >&2; production_die '必须提供 --target restore_drill_*。'; }
[[ "$target_database" =~ ^restore_drill_[a-zA-Z0-9_]+$ ]] ||
  production_die '恢复目标必须是带 restore_drill_ 前缀的隔离数据库名。'

env_file="$PRODUCTION_ENV_FILE"
compose_file="$PRODUCTION_COMPOSE_FILE"
production_load_env_file "$env_file"
PRODUCTION_ENV_FILE="$env_file"
PRODUCTION_COMPOSE_FILE="$compose_file"
production_preflight
[[ "$target_database" != "$POSTGRES_DB" ]] || production_die '恢复目标不得等于生产数据库名。'
production_require_commands sha256sum basename dirname rm
production_compose config --quiet
[[ -f "$backup_path" ]] || production_die "找不到备份文件：${backup_path}"
checksum_path="${backup_path}.sha256"
[[ -f "$checksum_path" ]] || production_die "找不到备份 SHA-256 文件：${checksum_path}"

(
  cd -- "$(dirname -- "$backup_path")"
  sha256sum -c "$(basename -- "$checksum_path")" >/dev/null
)
production_compose exec -T postgres pg_restore \
  --username="$POSTGRES_USER" \
  --list < "$backup_path" >/dev/null

# The source cluster must be up, healthy, and connected to the configured
# production database before we create the isolated drill target.
db_container_id="$(production_container_id postgres)"
db_state="$(docker inspect --format '{{.State.Status}}' "$db_container_id")"
[[ "$db_state" == 'running' ]] || production_die "PostgreSQL 未运行（当前状态：${db_state}）。"
db_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$db_container_id")"
[[ "$db_health" == 'healthy' ]] || production_die "PostgreSQL healthcheck 未通过（状态：${db_health}）。"

actual_database="$(production_compose exec -T postgres psql \
  --no-psqlrc \
  --username="$POSTGRES_USER" \
  --dbname="$DATABASE_URL" \
  --set=ON_ERROR_STOP=1 \
  --tuples-only \
  --no-align \
  --command='SELECT current_database();')"
[[ "$actual_database" == "$POSTGRES_DB" ]] || production_die 'DATABASE_URL 未连接到配置的生产源库。'

existing_target="$(production_compose exec -T postgres psql \
  --no-psqlrc \
  --username="$POSTGRES_USER" \
  --dbname="$DATABASE_URL" \
  --set=ON_ERROR_STOP=1 \
  --tuples-only \
  --no-align \
  --set="target_database=$target_database" \
  --command="SELECT 1 FROM pg_database WHERE datname = :'target_database';")"
[[ -z "$existing_target" ]] ||
  production_die "恢复目标已存在，拒绝覆盖：${target_database}"

created_target=0
cleanup() {
  local status=$?
  trap - EXIT
  if (( created_target == 1 )); then
    if ! production_compose exec -T postgres dropdb \
      --username="$POSTGRES_USER" \
      --maintenance-db="$POSTGRES_DB" \
      "$target_database" >/dev/null; then
      printf '恢复演练目标删除失败：%s；请人工删除该 restore_drill_* 数据库。\n' "$target_database" >&2
      status=1
    fi
  fi
  exit "$status"
}
trap cleanup EXIT

production_compose exec -T postgres createdb \
  --username="$POSTGRES_USER" \
  --maintenance-db="$POSTGRES_DB" \
  --template=template0 \
  "$target_database"
created_target=1

# Restore is intentionally directed to the isolated target, never DATABASE_URL.
production_compose exec -T postgres pg_restore \
  --username="$POSTGRES_USER" \
  --exit-on-error \
  --single-transaction \
  --no-owner \
  --no-acl \
  --dbname="$target_database" < "$backup_path"

schema_check="$(production_compose exec -T postgres psql \
  --no-psqlrc \
  --username="$POSTGRES_USER" \
  --dbname="$target_database" \
  --set=ON_ERROR_STOP=1 \
  --set="target_database=$target_database" \
  --tuples-only \
  --no-align \
  --command="SELECT current_database() = :'target_database' AND count(*) FILTER (WHERE schemaname = 'public' AND tablename IN ('user', 'learning_map_version', 'generation_task')) = 3 FROM pg_catalog.pg_tables;")"
[[ "$schema_check" == 't' ]] || production_die '恢复后的核心 schema 校验失败。'

printf 'PostgreSQL 恢复演练通过：已校验并恢复到隔离目标 %s，随后将删除该目标。\n' "$target_database"
