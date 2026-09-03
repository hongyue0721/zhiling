#!/usr/bin/env bash
set -Eeuo pipefail

readonly SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPOSITORY_ROOT="$(cd -- "${SCRIPT_DIRECTORY}/.." && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIRECTORY}/lib/production.sh"

PRODUCTION_ENV_FILE="${PRODUCTION_ENV_FILE:-/etc/zhijing/production.env}"
PRODUCTION_COMPOSE_FILE="${PRODUCTION_COMPOSE_FILE:-${REPOSITORY_ROOT}/compose.production.yaml}"

while (($# > 0)); do
  case "$1" in
    --env-file)
      (($# >= 2)) || production_die '--env-file 需要路径。'
      PRODUCTION_ENV_FILE="$2"
      shift 2
      ;;
    --help|-h)
      printf '用法：preflight-production.sh [--env-file PATH]\n'
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
production_preflight
production_compose config --quiet
printf '生产环境预检通过（未输出任何 secret）：%s\n' "$IMAGE_TAG"
