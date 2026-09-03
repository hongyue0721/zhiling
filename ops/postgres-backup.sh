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

usage() {
  cat <<'USAGE'
用法：postgres-backup.sh [--env-file PATH] BACKUP.dump

从正在运行的生产 PostgreSQL 读取 custom-format pg_dump。输出先写入同目录
的 0600 临时文件，完成后原子 rename，并生成同样原子发布的 .sha256 文件。
目标文件已存在时失败，不会覆盖或删除任何生产数据库数据。
USAGE
}

while (($# > 0)); do
  case "$1" in
    --env-file)
      (($# >= 2)) || production_die '--env-file 需要路径。'
      PRODUCTION_ENV_FILE="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    --)
      shift
      (($# == 1)) || production_die '必须且只能提供一个备份目标文件。'
      backup_path="$1"
      shift
      ;;
    -*)
      production_die "未知参数：$1"
      ;;
    *)
      [[ -z "$backup_path" ]] || production_die '必须且只能提供一个备份目标文件。'
      backup_path="$1"
      shift
      ;;
  esac
done

[[ -n "$backup_path" ]] || { usage >&2; production_die '必须提供备份目标文件。'; }
[[ "$backup_path" != */ ]] || production_die '备份目标必须是文件而不是目录。'

env_file="$PRODUCTION_ENV_FILE"
compose_file="$PRODUCTION_COMPOSE_FILE"
production_load_env_file "$env_file"
PRODUCTION_ENV_FILE="$env_file"
PRODUCTION_COMPOSE_FILE="$compose_file"
production_preflight
production_require_commands mkdir mktemp sha256sum mv rm dirname basename chmod rmdir
production_compose config --quiet

backup_dir="$(dirname -- "$backup_path")"
mkdir -p -- "$backup_dir"
chmod 700 -- "$backup_dir"
checksum_path="${backup_path}.sha256"
lock_path="${backup_path}.lock"
[[ ! -e "$backup_path" && ! -e "$checksum_path" ]] ||
  production_die "备份目标或校验文件已存在，拒绝覆盖：${backup_path}"
mkdir -- "$lock_path" || production_die "无法取得备份锁：${lock_path}"

temporary_dump=""
temporary_checksum=""
backup_created=0
cleanup() {
  local status=$?
  trap - EXIT
  [[ -z "$temporary_dump" ]] || rm -f -- "$temporary_dump"
  [[ -z "$temporary_checksum" ]] || rm -f -- "$temporary_checksum"
  if (( status != 0 && backup_created == 1 )); then
    rm -f -- "$backup_path" "$checksum_path"
  fi
  rmdir -- "$lock_path" 2>/dev/null || true
  exit "$status"
}
trap cleanup EXIT

db_container_id="$(production_container_id postgres)"
db_state="$(docker inspect --format '{{.State.Status}}' "$db_container_id")"
[[ "$db_state" == 'running' ]] ||
  production_die "PostgreSQL 未运行（当前状态：${db_state}）；备份脚本不会替你启动或重建生产库。"
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
[[ "$actual_database" == "$POSTGRES_DB" ]] ||
  production_die 'DATABASE_URL 未连接到 Compose 生产数据库；拒绝继续。'

temporary_dump="$(mktemp "${backup_path}.tmp.XXXXXX")"
# Stream the archive out of the container. The DSN is never printed and the
# dump is never written into the PostgreSQL data volume.
production_compose exec -T postgres pg_dump \
  --username="$POSTGRES_USER" \
  --format=custom \
  --no-owner \
  --no-acl \
  --dbname="$DATABASE_URL" > "$temporary_dump"
[[ -s "$temporary_dump" ]] || production_die 'pg_dump 生成了空文件。'

checksum_line="$(sha256sum -- "$temporary_dump")"
checksum_digest="${checksum_line%% *}"
[[ "$checksum_digest" =~ ^[0-9a-f]{64}$ ]] || production_die '无法计算备份 SHA-256。'
mv -- "$temporary_dump" "$backup_path"
temporary_dump=""
backup_created=1

temporary_checksum="$(mktemp "${checksum_path}.tmp.XXXXXX")"
printf '%s  %s\n' "$checksum_digest" "$(basename -- "$backup_path")" > "$temporary_checksum"
mv -- "$temporary_checksum" "$checksum_path"
temporary_checksum=""

# Verify both the checksum and archive directory before declaring success.
(
  cd -- "$backup_dir"
  sha256sum -c "$(basename -- "$checksum_path")" >/dev/null
)
production_compose exec -T postgres pg_restore --username="$POSTGRES_USER" --list < "$backup_path" >/dev/null

printf 'PostgreSQL 备份完成：%s\n' "$backup_path"
printf 'SHA-256 校验文件：%s\n' "$checksum_path"
