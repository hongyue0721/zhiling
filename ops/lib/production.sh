#!/usr/bin/env bash

# Shared, deliberately strict helpers for production-only entrypoints.
# This file never supplies a production secret or password. Every caller must
# load its root-owned environment file before invoking production_preflight.

production_die() {
  printf '生产运维失败：%s\n' "$1" >&2
  exit 1
}

production_load_env_file() {
  local path="$1"

  [[ -n "$path" ]] || production_die '生产环境文件路径不能为空。'
  [[ -f "$path" ]] || production_die "找不到生产环境文件：${path}"
  [[ -r "$path" ]] || production_die "生产环境文件不可读：${path}"

  if command -v stat >/dev/null 2>&1; then
    local mode owner current_user
    mode="$(stat -c '%a' -- "$path" 2>/dev/null || true)"
    owner="$(stat -c '%u' -- "$path" 2>/dev/null || true)"
    current_user="$(id -u)"
    [[ "$mode" =~ ^[0-7]{3,4}$ ]] || production_die "无法读取生产环境文件权限：${path}"
    if (( (8#$mode & 077) != 0 )); then
      production_die "生产环境文件必须禁止组/其他用户读取（建议 chmod 600）：${path}"
    fi
    if [[ "$owner" != "$current_user" && "$owner" != '0' ]]; then
      production_die "生产环境文件必须由部署用户或 root 持有：${path}"
    fi
  fi

  # The file is an operator-managed, root-owned shell-style env file. It is
  # intentionally sourced only after the permission checks above.
  set -a
  # shellcheck disable=SC1090
  if ! source "$path"; then
    set +a
    production_die "无法解析生产环境文件：${path}"
  fi
  set +a
}

production_require_commands() {
  local command_name
  for command_name in "$@"; do
    command -v "$command_name" >/dev/null 2>&1 ||
      production_die "缺少命令：${command_name}"
  done
}

production_require_env() {
  local key
  for key in "$@"; do
    [[ -n "${!key:-}" ]] || production_die "生产环境变量 ${key} 必须设置且非空。"
  done
}

production_reject_placeholder() {
  local key="$1"
  local value="$2"
  local normalized="${value,,}"

  if [[ "$value" == "<"*">" ]]; then
    production_die "生产环境变量 ${key} 仍是占位值。"
  fi
  case "$normalized" in
    changeme|change_me|change-me|replace_me|replace-me|replace|example|example.com|password|secret|your_*|zhijing-local|zhijing-local-test)
      production_die "生产环境变量 ${key} 仍是占位值。"
      ;;
  esac
}

production_validate_image_tag() {
  local tag="$1"
  [[ "$tag" =~ ^[0-9a-f]{40}$ ]] ||
    production_die 'IMAGE_TAG 必须是 40 位小写 Git 提交 SHA；禁止 latest、分支名和可变标签。'
}

production_validate_database_url() {
  local database_url="$1"
  local expected_database="$2"
  local expected_user="$3"
  local url_pattern='^postgres(ql)?://([A-Za-z_][A-Za-z0-9_]*):([^@#[:space:]]+)@postgres:5432/([A-Za-z_][A-Za-z0-9_]*)(\?[^#[:space:]]*)?$'

  [[ "$database_url" =~ $url_pattern ]] ||
    production_die 'DATABASE_URL 必须连接 Compose postgres:5432，包含配置用户、密码和数据库名；禁止公网、回环地址、错库或自定义主机。'
  [[ "${BASH_REMATCH[2]}" == "$expected_user" ]] ||
    production_die 'DATABASE_URL 用户必须与 POSTGRES_USER 完全一致。'
  [[ "${BASH_REMATCH[4]}" == "$expected_database" ]] ||
    production_die 'DATABASE_URL 数据库名必须与 POSTGRES_DB 完全一致。'
}

production_acquire_release_lock() {
  local lock_path='/run/lock/zhijing-production-release.lock'
  local inherited_path

  production_require_commands flock readlink
  if [[ "${PRODUCTION_RELEASE_LOCK_HELD:-}" == '1' ]]; then
    inherited_path="$(readlink -- /proc/self/fd/9 2>/dev/null || true)"
    [[ "$inherited_path" == "$lock_path" ]] ||
      production_die '发布锁标记无效；拒绝在未继承全局锁时继续。'
    flock -x 9 || production_die '无法确认继承的生产发布锁。'
    return 0
  fi

  exec 9>"$lock_path" ||
    production_die "无法打开生产发布锁：${lock_path}"
  flock -x 9 ||
    production_die "无法取得生产发布锁：${lock_path}"
  PRODUCTION_RELEASE_LOCK_HELD=1
  export PRODUCTION_RELEASE_LOCK_HELD
}

production_preflight() {
  local environment="${1:-production}"
  local expected_project expected_volume
  case "$environment" in
    production)
      expected_project='zhijing-production'
      expected_volume='zhijing-postgres-production'
      ;;
    staging)
      expected_project='zhijing-staging'
      expected_volume='zhijing-postgres-staging'
      ;;
    *)
      production_die "未知运维环境：${environment}"
      ;;
  esac

  production_require_commands docker stat id sleep tr
  docker compose version >/dev/null 2>&1 ||
    production_die '当前 Docker 未安装或 Docker Compose v2 不可用。'

  production_require_env \
    ZHIJING_ENVIRONMENT \
    COMPOSE_PROJECT_NAME \
    POSTGRES_VOLUME_NAME \
    IMAGE_REPOSITORY \
    IMAGE_TAG \
    POSTGRES_DB \
    POSTGRES_USER \
    POSTGRES_PASSWORD \
    DATABASE_URL \
    BETTER_AUTH_SECRET \
    BETTER_AUTH_URL \
    BETTER_AUTH_TRUSTED_ORIGINS \
    BETTER_AUTH_TRUSTED_PROXIES \
    RESEND_API_KEY \
    AUTH_EMAIL_FROM \
    GENERATION_RATE_LIMIT_WINDOW_SECONDS \
    GENERATION_RATE_LIMIT_MAX_REQUESTS \
    ZHIHU_ACCESS_SECRET \
    ZHIHU_MODEL \
    ZHIHU_SOURCE_TIMEOUT_MS \
    ZHIHU_MODEL_TIMEOUT_MS \
    GENERATION_WORKER_ID \
    WEB_BIND_PORT

  [[ "$ZHIJING_ENVIRONMENT" == "$environment" ]] ||
    production_die "ZHIJING_ENVIRONMENT=${ZHIJING_ENVIRONMENT} 与当前运维入口 ${environment} 不匹配。"
  [[ "$COMPOSE_PROJECT_NAME" == "$expected_project" ]] ||
    production_die "COMPOSE_PROJECT_NAME 必须固定为 ${expected_project}；拒绝连接错误 Compose 项目。"
  [[ "$POSTGRES_VOLUME_NAME" == "$expected_volume" ]] ||
    production_die "POSTGRES_VOLUME_NAME 必须固定为 ${expected_volume}；拒绝连接错误数据库卷。"

  production_validate_image_tag "$IMAGE_TAG"
  [[ "$IMAGE_REPOSITORY" =~ ^[a-z0-9][a-z0-9._/-]*[a-z0-9]$ ]] ||
    production_die 'IMAGE_REPOSITORY 必须是小写 Docker 仓库名。'
  [[ "$COMPOSE_PROJECT_NAME" =~ ^[a-z0-9][a-z0-9_-]*$ ]] ||
    production_die 'COMPOSE_PROJECT_NAME 含有不允许的字符。'

  local identifier
  for identifier in POSTGRES_DB POSTGRES_USER; do
    [[ "${!identifier}" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]] ||
      production_die "${identifier} 必须是安全的 PostgreSQL 标识符。"
  done

  if [[ "$environment" == 'staging' ]]; then
    [[ "$POSTGRES_DB" == staging_* || "$POSTGRES_DB" == drill_* ]] ||
      production_die 'staging 环境的 POSTGRES_DB 必须以 staging_ 或 drill_ 开头。'
  else
    [[ "$POSTGRES_DB" != staging_* && "$POSTGRES_DB" != drill_* ]] ||
      production_die 'production 环境拒绝使用 staging_/drill_ 数据库。'
  fi

  production_reject_placeholder POSTGRES_PASSWORD "$POSTGRES_PASSWORD"
  (( ${#POSTGRES_PASSWORD} >= 24 )) ||
    production_die 'POSTGRES_PASSWORD 至少需要 24 个字符。'
  [[ "$POSTGRES_PASSWORD" != "$POSTGRES_USER" && "$POSTGRES_PASSWORD" != "$POSTGRES_DB" ]] ||
    production_die 'POSTGRES_PASSWORD 不得与数据库用户或数据库名相同。'

  production_validate_database_url "$DATABASE_URL" "$POSTGRES_DB" "$POSTGRES_USER"

  [[ "$BETTER_AUTH_SECRET" != *$'\n'* && "$BETTER_AUTH_SECRET" != *$'\r'* ]] ||
    production_die 'BETTER_AUTH_SECRET 不得包含换行。'
  (( ${#BETTER_AUTH_SECRET} >= 32 )) ||
    production_die 'BETTER_AUTH_SECRET 至少需要 32 个字符。'
  production_reject_placeholder BETTER_AUTH_SECRET "$BETTER_AUTH_SECRET"

  [[ "$BETTER_AUTH_URL" =~ ^https://[^/:[:space:]]+(:[0-9]+)?/?$ ]] ||
    production_die 'BETTER_AUTH_URL 必须是 HTTPS origin。'
  [[ "$BETTER_AUTH_TRUSTED_ORIGINS" != *'http://'* ]] ||
    production_die '生产 BETTER_AUTH_TRUSTED_ORIGINS 不得包含 HTTP origin。'
  [[ "$BETTER_AUTH_TRUSTED_PROXIES" != *'0.0.0.0/0'* && "$BETTER_AUTH_TRUSTED_PROXIES" != *'::/0'* ]] ||
    production_die 'BETTER_AUTH_TRUSTED_PROXIES 不得信任全网段。'

  [[ "$AUTH_EMAIL_FROM" != *$'\n'* && "$AUTH_EMAIL_FROM" != *$'\r'* ]] ||
    production_die 'AUTH_EMAIL_FROM 不得包含换行。'
  local email_pattern='^([^[:space:]<>]+@[^[:space:]<>]+|.+<[^[:space:]<>]+@[^[:space:]<>]+>)$'
  [[ "$AUTH_EMAIL_FROM" =~ $email_pattern ]] ||
    production_die 'AUTH_EMAIL_FROM 必须是邮箱或显示名加邮箱。'
  production_reject_placeholder RESEND_API_KEY "$RESEND_API_KEY"

  [[ "$ZHIHU_MODEL" == 'zhida-thinking-1p5' ]] ||
    production_die 'ZHIHU_MODEL 必须是冻结的 zhida-thinking-1p5。'
  production_reject_placeholder ZHIHU_ACCESS_SECRET "$ZHIHU_ACCESS_SECRET"
  local timeout_key timeout_value
  for timeout_key in ZHIHU_SOURCE_TIMEOUT_MS ZHIHU_MODEL_TIMEOUT_MS; do
    timeout_value="${!timeout_key}"
    [[ "$timeout_value" =~ ^[1-9][0-9]{0,5}$ ]] ||
      production_die "${timeout_key} 必须是 1 至 600000 的整数。"
    (( timeout_value <= 600000 )) ||
      production_die "${timeout_key} 必须不超过 600000。"
  done

  local rate_key rate_value
  for rate_key in GENERATION_RATE_LIMIT_WINDOW_SECONDS GENERATION_RATE_LIMIT_MAX_REQUESTS; do
    rate_value="${!rate_key}"
    [[ "$rate_value" =~ ^[1-9][0-9]*$ ]] ||
      production_die "${rate_key} 必须是正整数。"
    (( ${#rate_value} <= 16 )) ||
      production_die "${rate_key} 超出 JavaScript 安全整数范围。"
    (( rate_value <= 9007199254740991 )) ||
      production_die "${rate_key} 超出 JavaScript 安全整数范围。"
  done

  [[ "$GENERATION_WORKER_ID" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] ||
    production_die 'GENERATION_WORKER_ID 必须是稳定且无空白的标识符。'
  [[ "$WEB_BIND_PORT" =~ ^[1-9][0-9]{0,4}$ ]] ||
    production_die 'WEB_BIND_PORT 必须是 1 至 65535 的端口。'
  (( WEB_BIND_PORT <= 65535 )) || production_die 'WEB_BIND_PORT 必须不超过 65535。'
  [[ "$WEB_BIND_PORT" == '3000' ]] ||
    production_die 'WEB_BIND_PORT 必须固定为 3000，并与 Nginx upstream 保持单一事实源。'

  # Compose interpolation is checked before any container is started. Keep
  # this explicit so a missing value cannot silently become a local default.
  [[ -n "${PRODUCTION_COMPOSE_FILE:-}" ]] ||
    production_die 'PRODUCTION_COMPOSE_FILE 未设置。'
  [[ -f "$PRODUCTION_COMPOSE_FILE" ]] ||
    production_die "找不到生产 Compose 文件：${PRODUCTION_COMPOSE_FILE}"
  [[ "${REPOSITORY_ROOT:-}/compose.production.yaml" == "$PRODUCTION_COMPOSE_FILE" ]] ||
    production_die '生产与 staging 运维入口只能使用仓库根目录 compose.production.yaml。'
}
production_wait_for_running() {
  local container_id="$1"
  local timeout_seconds="$2"
  local elapsed=0
  local state

  while (( elapsed < timeout_seconds )); do
    state="$(docker inspect --format '{{.State.Status}}' "$container_id" 2>/dev/null || true)"
    case "$state" in
      running) return 0 ;;
      exited|dead) return 1 ;;
    esac
    sleep 2
    elapsed=$((elapsed + 2))
  done
  return 1
}


production_compose() {
  docker compose \
    --project-name "$COMPOSE_PROJECT_NAME" \
    --env-file "$PRODUCTION_ENV_FILE" \
    --file "$PRODUCTION_COMPOSE_FILE" \
    "$@"
}

production_container_id() {
  local service="$1"
  local id
  id="$(production_compose ps --quiet "$service")"
  [[ -n "$id" ]] || production_die "找不到 Compose 服务容器：${service}"
  printf '%s\n' "$id"
}

production_container_id_all() {
  local service="$1"
  local ids
  ids="$(production_compose ps --all --quiet "$service")"
  [[ -n "$ids" ]] || production_die "找不到 Compose 服务容器：${service}"
  # Multiple IDs mean stale one-off containers or an ambiguous deployment.
  # Fail closed instead of checking the wrong migration/worker container.
  [[ "$ids" != *$'\n'* ]] ||
    production_die "Compose 服务 ${service} 存在多个容器，拒绝猜测健康状态。"
  printf '%s\n' "$ids"
}

production_wait_for_health() {
  local container_id="$1"
  local timeout_seconds="$2"
  local elapsed=0
  local status

  while (( elapsed < timeout_seconds )); do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container_id" 2>/dev/null || true)"
    case "$status" in
      healthy) return 0 ;;
      unhealthy) return 1 ;;
    esac
    sleep 2
    elapsed=$((elapsed + 2))
  done
  return 1
}

production_wait_for_exit() {
  local container_id="$1"
  local timeout_seconds="$2"
  local elapsed=0
  local state exit_code

  while (( elapsed < timeout_seconds )); do
    state="$(docker inspect --format '{{.State.Status}}' "$container_id" 2>/dev/null || true)"
    if [[ "$state" == 'exited' || "$state" == 'dead' ]]; then
      exit_code="$(docker inspect --format '{{.State.ExitCode}}' "$container_id")"
      [[ "$exit_code" == '0' ]] && return 0
      return 1
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done
  return 1
}

production_assert_running() {
  local service="$1"
  local container_id state
  container_id="$(production_container_id "$service")"
  state="$(docker inspect --format '{{.State.Status}}' "$container_id")"
  [[ "$state" == 'running' ]] || production_die "服务 ${service} 未运行（当前状态：${state}）。"
}
