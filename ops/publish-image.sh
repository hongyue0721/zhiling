#!/usr/bin/env bash
set -Eeuo pipefail

readonly SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPOSITORY_ROOT="$(cd -- "${SCRIPT_DIRECTORY}/.." && pwd)"

IMAGE_REPOSITORY="${IMAGE_REPOSITORY:-}"
IMAGE_TAG="${IMAGE_TAG:-}"
# Next.js evaluates server configuration while collecting routes. These values
# make that build-time evaluation explicit without placing production secrets in
# the build context or final runtime image; production values are injected only
# by compose at container startup.
readonly BUILD_DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build"
readonly BUILD_BETTER_AUTH_SECRET="build-only-auth-secret-not-used-at-runtime-123456"
readonly BUILD_BETTER_AUTH_URL="http://localhost:3000"
readonly BUILD_BETTER_AUTH_TRUSTED_ORIGINS="http://localhost:3000"
readonly BUILD_BETTER_AUTH_TRUSTED_PROXIES="127.0.0.1"
readonly BUILD_EMAIL_VERIFICATION_ENABLED="false"
readonly BUILD_GENERATION_RATE_LIMIT_WINDOW_SECONDS="60"
readonly BUILD_GENERATION_RATE_LIMIT_MAX_REQUESTS="30"


usage() {
  cat <<'USAGE'
用法：publish-image.sh [--repository REGISTRY/IMAGE] [--tag 40位提交SHA]

从当前 checkout 构建并推送一个不可变提交 SHA 镜像。脚本不读取或传入
任何生产 secret；Dockerfile 的运行时配置全部在容器启动时注入。Registry
必须拒绝同一 tag 的二次写入。
USAGE
}

while (($# > 0)); do
  case "$1" in
    --repository)
      (($# >= 2)) || { printf '%s\n' '--repository 需要仓库名。' >&2; exit 2; }
      IMAGE_REPOSITORY="$2"
      shift 2
      ;;
    --tag)
      (($# >= 2)) || { printf '%s\n' '--tag 需要提交 SHA。' >&2; exit 2; }
      IMAGE_TAG="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      printf '未知参数：%s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

command -v docker >/dev/null 2>&1 || { printf '%s\n' '缺少 docker。' >&2; exit 1; }
command -v git >/dev/null 2>&1 || { printf '%s\n' '缺少 git。' >&2; exit 1; }

if [[ -z "$IMAGE_TAG" ]]; then
  IMAGE_TAG="$(git -C "$REPOSITORY_ROOT" rev-parse HEAD)"
fi
[[ -n "$IMAGE_REPOSITORY" ]] || { printf '%s\n' '必须设置 IMAGE_REPOSITORY 或 --repository。' >&2; exit 1; }
[[ "$IMAGE_REPOSITORY" =~ ^[a-z0-9][a-z0-9._/-]*[a-z0-9]$ ]] || {
  printf '%s\n' 'IMAGE_REPOSITORY 必须是小写 Docker 仓库名。' >&2
  exit 1
}
[[ "$IMAGE_TAG" =~ ^[0-9a-f]{40}$ ]] || {
  printf '%s\n' 'IMAGE_TAG 必须是 40 位小写 Git 提交 SHA；禁止 latest、分支名和可变标签。' >&2
  exit 1
}

head_commit="$(git -C "$REPOSITORY_ROOT" rev-parse HEAD)"
[[ "$IMAGE_TAG" == "$head_commit" ]] || {
  printf '%s\n' 'IMAGE_TAG 必须等于当前 checkout 的 HEAD，拒绝用错误 SHA 标记镜像。' >&2
  exit 1
}
[[ -z "$(git -C "$REPOSITORY_ROOT" status --porcelain)" ]] || {
  printf '%s\n' 'checkout 有未提交变更，拒绝用提交 SHA 构建可变内容。' >&2
  exit 1
}

image="${IMAGE_REPOSITORY}:${IMAGE_TAG}"
# Refuse to overwrite an existing tag. A registry-side immutable-tag policy is
# still required; this local check only closes the common operator mistake.
if docker manifest inspect "$image" >/dev/null 2>&1; then
  printf '镜像 tag 已存在，拒绝覆盖：%s\n' "$image" >&2
  exit 1
fi

docker build \
  --pull \
  --build-arg "BUILD_DATABASE_URL=${BUILD_DATABASE_URL}" \
  --build-arg "BUILD_BETTER_AUTH_SECRET=${BUILD_BETTER_AUTH_SECRET}" \
  --build-arg "BUILD_BETTER_AUTH_URL=${BUILD_BETTER_AUTH_URL}" \
  --build-arg "BUILD_BETTER_AUTH_TRUSTED_ORIGINS=${BUILD_BETTER_AUTH_TRUSTED_ORIGINS}" \
  --build-arg "BUILD_BETTER_AUTH_TRUSTED_PROXIES=${BUILD_BETTER_AUTH_TRUSTED_PROXIES}" \
  --build-arg "BUILD_EMAIL_VERIFICATION_ENABLED=${BUILD_EMAIL_VERIFICATION_ENABLED}" \
  --build-arg "BUILD_GENERATION_RATE_LIMIT_WINDOW_SECONDS=${BUILD_GENERATION_RATE_LIMIT_WINDOW_SECONDS}" \
  --build-arg "BUILD_GENERATION_RATE_LIMIT_MAX_REQUESTS=${BUILD_GENERATION_RATE_LIMIT_MAX_REQUESTS}" \
  --label "org.opencontainers.image.revision=${IMAGE_TAG}" \
  --label "org.opencontainers.image.source=zhijing" \
  --tag "$image" \
  --file Dockerfile \
  .
docker push "$image"

printf '镜像已推送：%s\n' "$image"
printf '请在 Registry 保留并锁定该 SHA tag；生产发布必须使用同一 tag。\n'
