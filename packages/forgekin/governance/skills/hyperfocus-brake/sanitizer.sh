#!/usr/bin/env bash
# F085 Hyperfocus Brake - Context Sanitizer
# P1 安全要求：防止占位符注入攻击

set -euo pipefail

# 安全常量
MAX_LENGTH=80
ALLOWED_CHARS='[^A-Za-z0-9._/-]'

# 消毒单个字符串
# - 只允许 [A-Za-z0-9._/-]
# - 其他字符替换为 _
# - 超过 80 字符截断并加 …
# - @ 替换为 ＠（全角）
# - 反引号替换为 '
# - 方括号替换为全角 ［ ］
sanitize() {
  local input="$1"
  local result

  # 步骤 1: 替换危险字符为安全等价物
  result="${input//@/＠}"           # @ → 全角 ＠
  result="${result//\`/\'}"         # 反引号 → 单引号
  result="${result//\[/［}"         # [ → 全角 ［
  result="${result//\]/］}"         # ] → 全角 ］

  # 步骤 2: 替换其他非允许字符为 _
  result=$(echo "$result" | sed "s/$ALLOWED_CHARS/_/g")

  # 步骤 3: 截断
  if [[ ${#result} -gt $MAX_LENGTH ]]; then
    result="${result:0:$((MAX_LENGTH - 1))}…"
  fi

  echo "$result"
}

# 消毒分支名
sanitize_branch() {
  sanitize "$1"
}

# 消毒功能名/特性名
sanitize_feature() {
  sanitize "$1"
}

# 消毒 TODO 项
sanitize_todo() {
  sanitize "$1"
}

# 从 git 获取安全的分支名
get_safe_branch() {
  local cwd="${1:-.}"
  local branch

  if git -C "$cwd" rev-parse --git-dir >/dev/null 2>&1; then
    branch=$(git -C "$cwd" branch --show-current 2>/dev/null || echo "unknown")
  else
    branch="unknown"
  fi

  sanitize_branch "$branch"
}

# 从 git 获取安全的最近 commit 信息
get_safe_last_commit() {
  local cwd="${1:-.}"
  local commit

  if git -C "$cwd" rev-parse --git-dir >/dev/null 2>&1; then
    commit=$(git -C "$cwd" log -1 --pretty=format:'%s' 2>/dev/null || echo "unknown")
  else
    commit="unknown"
  fi

  sanitize "$commit"
}

# 批量消毒 JSON 对象中的字符串字段
sanitize_json_strings() {
  local json="$1"
  local fields="$2"  # 空格分隔的字段名列表

  for field in $fields; do
    local value
    value=$(echo "$json" | jq -r ".$field // empty")
    if [[ -n "$value" ]]; then
      local sanitized
      sanitized=$(sanitize "$value")
      json=$(echo "$json" | jq --arg f "$field" --arg v "$sanitized" '.[$f] = $v')
    fi
  done

  echo "$json"
}

# 验证输入是否安全（用于测试）
is_safe() {
  local input="$1"

  # 检查长度
  if [[ ${#input} -gt $MAX_LENGTH ]]; then
    return 1
  fi

  # 检查危险字符
  if echo "$input" | grep -qE '[@`\[\]]'; then
    return 1
  fi

  # 检查非允许字符（除了我们的全角替换字符）
  # 简化检查：只检查危险的特殊字符
  if echo "$input" | grep -qP '[^A-Za-z0-9._/\-＠'"'"'″［］…_]'; then
    return 1
  fi

  return 0
}

# 如果直接运行脚本
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  case "${1:-help}" in
    sanitize)   sanitize "$2" ;;
    branch)     get_safe_branch "${2:-.}" ;;
    commit)     get_safe_last_commit "${2:-.}" ;;
    is_safe)    is_safe "$2" && echo "safe" || echo "unsafe" ;;
    *)
      echo "Usage: $0 {sanitize|branch|commit|is_safe} [input]"
      exit 1
      ;;
  esac
fi
