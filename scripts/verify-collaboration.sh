#!/usr/bin/env bash

set -euo pipefail

readonly SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPOSITORY_ROOT="$(cd -- "${SCRIPT_DIRECTORY}/.." && pwd)"

base_commit=""
head_commit="HEAD"

show_usage() {
  printf '用法：%s [--base <提交>] [--head <提交>]\n' "$0"
}

while (($# > 0)); do
  case "$1" in
    --base)
      if (($# < 2)) || [[ -z "$2" ]]; then
        printf '%s\n' '--base 需要一个提交参数。' >&2
        exit 2
      fi
      base_commit="$2"
      shift 2
      ;;
    --head)
      if (($# < 2)) || [[ -z "$2" ]]; then
        printf '%s\n' '--head 需要一个提交参数。' >&2
        exit 2
      fi
      head_commit="$2"
      shift 2
      ;;
    --help|-h)
      show_usage
      exit 0
      ;;
    *)
      printf '未知参数：%s\n' "$1" >&2
      show_usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "${head_commit}" ]]; then
  printf '%s\n' '--head 不能为空。' >&2
  exit 2
fi

cd -- "${REPOSITORY_ROOT}"

verify_commit_exists() {
  local commit="$1"

  if ! git cat-file -e "${commit}^{commit}" 2>/dev/null; then
    printf '找不到 Git 提交：%s\n' "${commit}" >&2
    exit 2
  fi
}

verify_git_whitespace() {
  local empty_tree

  empty_tree="$(git hash-object -t tree /dev/null)"
  git diff --check "${empty_tree}" "${head_commit}"
  git diff --check
  git diff --cached --check

  if [[ -n "${base_commit}" ]]; then
    git diff --check "${base_commit}" "${head_commit}"
  fi
}

verify_commit_messages() {
  if [[ -z "${base_commit}" ]]; then
    printf '%s\n' '未提供 --base，跳过新增提交说明检查。'
    return
  fi

  BASE_COMMIT="${base_commit}" HEAD_COMMIT="${head_commit}" ruby <<'RUBY'
require "open3"

base_commit = ENV.fetch("BASE_COMMIT")
head_commit = ENV.fetch("HEAD_COMMIT")
commit_range = "#{base_commit}..#{head_commit}"
commit_list, status = Open3.capture2("git", "rev-list", "--reverse", commit_range)
abort("无法读取提交范围 #{commit_range}") unless status.success?

errors = []
commit_list.lines(chomp: true).each do |commit|
  message, message_status = Open3.capture2(
    "git", "show", "--quiet", "--format=%s%x00%b", commit
  )
  unless message_status.success?
    errors << "#{commit[0, 12]}：无法读取提交信息"
    next
  end

  subject, body = message.split("\0", 2)
  short_commit = commit[0, 12]
  errors << "#{short_commit}：标题必须包含中文" unless subject&.match?(/\p{Han}/)

  %w[功能 原因 验证].each do |section|
    section_pattern = /^#{section}[：:]\s*\S.*$/
    next if body&.match?(section_pattern)

    errors << "#{short_commit}：正文缺少独立且非空的“#{section}：”行"
  end
end

unless errors.empty?
  warn "新增提交说明不符合协作规范："
  errors.each { |error| warn "- #{error}" }
  exit 1
end

puts "新增提交说明检查通过（#{commit_list.lines.count} 个提交）。"
RUBY
}

verify_markdown_links() {
  VERIFY_REPOSITORY_ROOT="${REPOSITORY_ROOT}" ruby <<'RUBY'
require "open3"
require "pathname"
require "uri"

repository_root = Pathname.new(ENV.fetch("VERIFY_REPOSITORY_ROOT")).realpath
file_list, status = Open3.capture2(
  "git", "ls-files", "-co", "--exclude-standard", "--", "*.md"
)
abort("无法读取 Markdown 文件清单") unless status.success?

markdown_files = file_list.lines(chomp: true).uniq.sort.select do |file|
  repository_root.join(file).file?
end
errors = []

validate_target = lambda do |source_file, line_number, raw_target|
  target = raw_target.to_s.strip
  if target.empty?
    errors << "#{source_file}:#{line_number}：本地链接目标为空"
    next
  end

  next if target.start_with?("#", "//")
  next if target.match?(/\A[a-z][a-z0-9+.-]*:/i)

  path_text = target.split(/[?#]/, 2).first
  next if path_text.nil? || path_text.empty?

  begin
    decoded_path = URI::DEFAULT_PARSER.unescape(path_text)
  rescue ArgumentError
    errors << "#{source_file}:#{line_number}：链接包含无效转义：#{target}"
    next
  end
  candidate = if decoded_path.start_with?("/")
                repository_root.join(decoded_path.delete_prefix("/"))
              else
                repository_root.join(File.dirname(source_file), decoded_path)
              end.cleanpath

  inside_repository = candidate == repository_root ||
    candidate.to_s.start_with?("#{repository_root}#{File::SEPARATOR}")
  unless inside_repository
    errors << "#{source_file}:#{line_number}：链接越出仓库边界：#{target}"
    next
  end

  unless candidate.exist?
    errors << "#{source_file}:#{line_number}：本地链接不存在：#{target}"
  end
end

markdown_files.each do |source_file|
  in_fenced_code = false
  fence_character = nil
  fence_length = 0

  File.foreach(repository_root.join(source_file)).with_index(1) do |line, line_number|
    if (fence_match = line.match(/^ {0,3}(`{3,}|~{3,})/))
      marker = fence_match[1]
      if !in_fenced_code
        in_fenced_code = true
        fence_character = marker[0]
        fence_length = marker.length
      elsif marker[0] == fence_character && marker.length >= fence_length
        in_fenced_code = false
      end
      next
    end
    next if in_fenced_code

    searchable_line = line.gsub(/(`+).*?\1/, "")
    searchable_line.scan(/!?\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))/) do |angle, plain|
      validate_target.call(source_file, line_number, angle || plain)
    end
    searchable_line.scan(/^ {0,3}\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))/) do |angle, plain|
      validate_target.call(source_file, line_number, angle || plain)
    end
    searchable_line.scan(/\b(?:href|src)=["']([^"']+)["']/i) do |html_target|
      validate_target.call(source_file, line_number, html_target.first)
    end
  end
end

unless errors.empty?
  warn "Markdown 本地链接检查失败："
  errors.uniq.each { |error| warn "- #{error}" }
  exit 1
end

puts "Markdown 本地链接检查通过（#{markdown_files.length} 个文件）。"
RUBY
}

verify_yaml_documents() {
  VERIFY_REPOSITORY_ROOT="${REPOSITORY_ROOT}" ruby <<'RUBY'
require "date"
require "open3"
require "pathname"
require "yaml"

repository_root = Pathname.new(ENV.fetch("VERIFY_REPOSITORY_ROOT"))
file_list, status = Open3.capture2(
  "git", "ls-files", "-co", "--exclude-standard", "--", "*.yml", "*.yaml"
)
abort("无法读取 YAML 文件清单") unless status.success?

yaml_files = file_list.lines(chomp: true).uniq.sort.select do |file|
  repository_root.join(file).file?
end
errors = []
yaml_files.each do |file|
  begin
    YAML.safe_load(
      repository_root.join(file).read,
      permitted_classes: [Date, Time],
      aliases: true
    )
  rescue Psych::Exception => error
    errors << "#{file}：#{error.message}"
  end
end

unless errors.empty?
  warn "YAML 解析检查失败："
  errors.each { |error| warn "- #{error}" }
  exit 1
end

puts "YAML 解析检查通过（#{yaml_files.length} 个文件）。"
RUBY
}

verify_openapi_document() {
  VERIFY_REPOSITORY_ROOT="${REPOSITORY_ROOT}" ruby <<'RUBY'
require "date"
require "pathname"
require "yaml"

openapi_path = Pathname.new(ENV.fetch("VERIFY_REPOSITORY_ROOT")).join("api/openapi.yaml")
abort("缺少 API 契约：api/openapi.yaml") unless openapi_path.file?

begin
  document = YAML.safe_load(
    openapi_path.read,
    permitted_classes: [Date, Time],
    aliases: true
  )
rescue Psych::Exception => error
  abort("OpenAPI YAML 解析失败：#{error.message}")
end

errors = []
unless document.is_a?(Hash)
  errors << "根节点必须是对象"
  document = {}
end

version = document["openapi"]
errors << "openapi 必须声明 3.0.x 或 3.1.x 版本" unless version.to_s.match?(/\A3\.(?:0|1)\.\d+\z/)

info = document["info"]
if info.is_a?(Hash)
  errors << "info.title 不能为空" if info["title"].to_s.strip.empty?
  errors << "info.version 不能为空" if info["version"].to_s.strip.empty?
else
  errors << "info 必须是对象"
end

paths = document["paths"]
if paths.is_a?(Hash)
  invalid_paths = paths.keys.reject do |path|
    path_text = path.to_s
    path_text.start_with?("/", "x-")
  end
  unless invalid_paths.empty?
    errors << "paths 中存在既非 / 路径也非 x- 扩展的字段：#{invalid_paths.join(', ')}"
  end
else
  errors << "paths 必须是对象"
end

if document.key?("components") && !document["components"].is_a?(Hash)
  errors << "components 存在时必须是对象"
end

resolve_pointer = lambda do |reference|
  next true unless reference.start_with?("#/")

  current = document
  reference.delete_prefix("#/").split("/").each do |raw_segment|
    segment = raw_segment.gsub("~1", "/").gsub("~0", "~")
    unless current.is_a?(Hash) && current.key?(segment)
      current = nil
      break
    end
    current = current[segment]
  end
  !current.nil?
end

walk_references = lambda do |value, location, walker|
  case value
  when Hash
    value.each do |key, child|
      child_location = "#{location}/#{key}"
      if key == "$ref" && child.is_a?(String) && !resolve_pointer.call(child)
        errors << "#{child_location} 指向不存在的本地引用：#{child}"
      else
        walker.call(child, child_location, walker)
      end
    end
  when Array
    value.each_with_index do |child, index|
      walker.call(child, "#{location}/#{index}", walker)
    end
  end
end
walk_references.call(document, "#", walk_references)

unless errors.empty?
  warn "OpenAPI 基础契约检查失败："
  errors.each { |error| warn "- #{error}" }
  exit 1
end

puts "OpenAPI YAML 检查通过（#{version}）。"
RUBY
}

verify_adr_index() {
  VERIFY_REPOSITORY_ROOT="${REPOSITORY_ROOT}" ruby <<'RUBY'
require "pathname"

repository_root = Pathname.new(ENV.fetch("VERIFY_REPOSITORY_ROOT"))
decision_directory = repository_root.join("docs/architecture/decisions")
index_path = decision_directory.join("README.md")
abort("缺少 ADR 索引：docs/architecture/decisions/README.md") unless index_path.file?

valid_statuses = %w[Proposed Accepted Rejected Deprecated Superseded].freeze
errors = []
decisions = {}

decision_directory.glob("[0-9][0-9][0-9][0-9]-*.md").sort.each do |path|
  number = path.basename.to_s[0, 4]
  next if number == "0000"

  content = path.read
  title_number = content[/^# ADR-(\d{4})[：:]/, 1]
  status = content[/^- 状态：([A-Za-z]+)\s*$/, 1]
  errors << "#{path.basename}：标题编号必须是 #{number}" unless title_number == number
  errors << "#{path.basename}：缺少有效状态" unless valid_statuses.include?(status)
  errors << "ADR 编号重复：#{number}" if decisions.key?(number)
  decisions[number] = { filename: path.basename.to_s, status: status }
end

index_entries = {}
index_path.each_line.with_index(1) do |line, line_number|
  match = line.match(/^\|\s*\[(\d{4})\]\(([^)]+)\)\s*\|\s*.+?\s*\|\s*([A-Za-z]+)\s*\|\s*$/)
  next unless match

  number, link, status = match.captures
  errors << "README.md:#{line_number}：ADR 编号重复：#{number}" if index_entries.key?(number)
  unless valid_statuses.include?(status)
    errors << "README.md:#{line_number}：无效 ADR 状态：#{status}"
  end
  index_entries[number] = { filename: link, status: status, line: line_number }
end

decisions.each do |number, decision|
  entry = index_entries[number]
  unless entry
    errors << "ADR-#{number} 未登记到索引"
    next
  end

  if entry[:filename] != decision[:filename]
    errors << "ADR-#{number} 索引链接应为 #{decision[:filename]}，实际为 #{entry[:filename]}"
  end
  if entry[:status] != decision[:status]
    errors << "ADR-#{number} 索引状态为 #{entry[:status]}，文档状态为 #{decision[:status]}"
  end
end

(index_entries.keys - decisions.keys).sort.each do |number|
  entry = index_entries[number]
  errors << "README.md:#{entry[:line]}：索引中的 ADR-#{number} 没有对应决策文件"
end

unless errors.empty?
  warn "ADR 索引检查失败："
  errors.each { |error| warn "- #{error}" }
  exit 1
end

puts "ADR 索引检查通过（#{decisions.length} 项决策）。"
RUBY
}

verify_commit_exists "${head_commit}"
if [[ -n "${base_commit}" ]]; then
  verify_commit_exists "${base_commit}"
fi

verify_git_whitespace
verify_commit_messages
verify_markdown_links
verify_yaml_documents
verify_openapi_document
verify_adr_index

printf '%s\n' '协作基线验证全部通过。'
