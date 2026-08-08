#!/usr/bin/env bash
# =============================================================================
# 三方编码智能体（CLI）一键部署 + 配置脚本
#
# 为 FlowForge 九灵智体批量安装并配置所依赖的三方 AI 编码 CLI：
#   - claude      (@anthropic-ai/claude-code)      经 claude-code-router 转发
#   - codex       (@openai/codex)                  经 responses proxy 转发
#   - gemini      (@google/gemini-cli)             经 gemini proxy 转发
#   - opencode    (opencode-ai)                    直连（内置默认模型）
#   - codebuddy   (@tencent-ai/codebuddy-code)    直连（hy3 默认模型）
#   - qodercli    (@qoder-ai/qodercli)             需 Qoder 账号登录（提示）
#   - iflow       (@iflow-ai/iflow-cli)            OpenAI-Compatible API
#   - trae        (IDE,非 CLI)                     TraeLLMClient 文件桥接
# 并部署配套基础设施：
#   - 协议转换代理（gemini/anthropic/responses -> OpenRoute 网关）
#   - Claude Code Router（claude-code-router，为 claude 提供 openroute/openrouter 模型）
#   - 写入 ~/.claude/settings.json、~/.codex/config.toml、~/.iflow/settings.json
#
# 用法：
#   bash scripts/setup_cli_agents.sh                 # 安装 + 配置 + 启动
#   bash scripts/setup_cli_agents.sh --only-install  # 仅安装 CLI 包
#   bash scripts/setup_cli_agents.sh --no-start      # 安装+配置，不启动代理
#
# 环境变量（可在脚本头部或部署时覆盖）：
#   OPENROUTE_API_KEY   OpenRoute 网关 API Key（默认取自 config/models.yaml）
#   OPENROUTER_API_KEY  OpenRouter API Key（默认从 ~/.config/Trae*/ 自动探测）
#   OPENROUTE_GATEWAY   OpenRoute 网关地址（默认 http://127.0.0.1:13001/v1）
#   GEMINI_CLI_VERSION  锁定 gemini-cli 版本（默认 0.43.0，v0.44+ 有 auth 回归 bug）
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
NPM_PREFIX="${NPM_CONFIG_PREFIX:-$HOME/.npm-global}"

ONLY_INSTALL=0
NO_START=0
SKIP_INSTALL=0
for arg in "$@"; do
  case "$arg" in
    --only-install) ONLY_INSTALL=1 ;;
    --no-start)     NO_START=1 ;;
    --skip-install) SKIP_INSTALL=1 ;;
  esac
done

# ---------------------------- 配置提取 ----------------------------
# 从 flowforge config/models.yaml 读取 OpenRoute 网关与 api_key（铁律5：不硬编码）
OPENROUTE_GATEWAY="${OPENROUTE_GATEWAY:-http://127.0.0.1:13001/v1}"
OPENROUTE_API_KEY="${OPENROUTE_API_KEY:-}"
if [ -z "$OPENROUTE_API_KEY" ] && [ -f "$PROJECT_ROOT/config/models.yaml" ]; then
  # 提取 openroute provider 的 api_key_default 字段
  OPENROUTE_API_KEY="$(grep -A6 -iE '^  openroute:' "$PROJECT_ROOT/config/models.yaml" | grep -iE 'api_key_default' | head -1 | sed -E 's/.*api_key_default:[[:space:]]*["'"'"']?([^"'"'"'# ,]+).*/\1/' || true)"
fi
if [ -z "$OPENROUTE_API_KEY" ]; then
  echo "[ERROR] 未找到 OpenRoute API Key。请在 config/models.yaml 配置 openroute.api_key 或设置 OPENROUTE_API_KEY。" >&2
  exit 1
fi

# OpenRouter key 默认从 Trae CN 用户配置自动探测
OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-}"
if [ -z "$OPENROUTER_API_KEY" ]; then
  OPENROUTER_API_KEY="$(grep -rhoE 'sk-or-v1-[a-zA-Z0-9]+' "$HOME/.config"/Trae*/User/History/ 2>/dev/null | sort -u | head -1 || true)"
fi

PY="python3"
if [ -x "$PROJECT_ROOT/.venv/bin/python" ]; then
  PY="$PROJECT_ROOT/.venv/bin/python"
fi

section() { printf '\n%s\n%s\n' "$1" "$(printf '%*s' 72 '' | tr ' ' '=')"; }
ok()   { echo "  [OK]   $*"; }
fail() { echo "  [FAIL] $*"; }
skip() { echo "  [SKIP] $*"; }

# ---------------------------- Step 1 基础设施 ----------------------------
check_gateway() {
  section "Step 1: OpenRoute 网关连通性"
  if curl -s -m 5 "${OPENROUTE_GATEWAY}/models" -H "Authorization: Bearer ${OPENROUTE_API_KEY}" >/dev/null 2>&1; then
    ok "OpenRoute 网关可达: ${OPENROUTE_GATEWAY}"
    return 0
  fi
  fail "OpenRoute 网关不可达: ${OPENROUTE_GATEWAY}. 请先启动 foremind openroute 组件。"
  return 1
}

# ---------------------------- Step 2 CLI 安装 ----------------------------
NPM_PKGS=(
  "@anthropic-ai/claude-code"
  "@openai/codex"
  "claude-code-router"
)
GEMINI_PKG="@google/gemini-cli"

install_clis() {
  section "Step 2: 安装三方编码 CLI（npm 全局）"
  if [ $SKIP_INSTALL -eq 1 ]; then
    skip "跳过 CLI 安装（--skip-install）"
    export PATH="$NPM_PREFIX/bin:$PATH"
    for b in claude codex gemini opencode codebuddy qodercli iflow ccr; do
      command -v "$b" >/dev/null 2>&1 && ok "二进制可用: $b -> $(command -v "$b")" || skip "二进制未找到: $b"
    done
    return 0
  fi
  mkdir -p "$NPM_PREFIX"
  npm config set prefix "$NPM_PREFIX" >/dev/null 2>&1 || true

  # node/npm 检查
  if ! command -v npm >/dev/null 2>&1; then
    fail "npm 未安装。请先安装 Node.js >= 18（https://nodejs.org/）"
    exit 1
  fi

  for pkg in "${NPM_PKGS[@]}" "opencode-ai" "@tencent-ai/codebuddy-code" "@qoder-ai/qodercli" "@iflow-ai/iflow-cli"; do
    echo "  -> npm install -g ${pkg}"
    if npm install -g "$pkg" >/dev/null 2>&1; then
      ok "已安装: ${pkg}"
    else
      fail "安装失败: ${pkg}（可重试，或网络受限）"
    fi
  done

  # gemini-cli 锁定版本（v0.44+ 有 auth+baseURL 回归 bug）
  echo "  -> npm install -g -E ${GEMINI_PKG}@${GEMINI_CLI_VERSION:-0.43.0}"
  if npm install -g -E "${GEMINI_PKG}@${GEMINI_CLI_VERSION:-0.43.0}" >/dev/null 2>&1; then
    ok "已安装: ${GEMINI_PKG}@${GEMINI_CLI_VERSION:-0.43.0}"
  else
    fail "gemini-cli 安装失败"
  fi

  export PATH="$NPM_PREFIX/bin:$PATH"
  echo ""
  for b in claude codex gemini opencode codebuddy qodercli iflow ccr; do
    if command -v "$b" >/dev/null 2>&1; then
      ok "二进制可用: $b -> $(command -v "$b")"
    else
      skip "二进制未找到: $b"
    fi
  done
}

# ---------------------------- Step 3 协议代理 + ccr ----------------------------
start_infra() {
  section "Step 3: 启动协议转换代理 + Claude Code Router"
  if [ $NO_START -eq 1 ]; then
    skip "跳过启动（--no-start）"
    return 0
  fi
  # 3.1 OpenRoute 协议代理（gemini 8082 / anthropic 8083 / responses 8084）
  if [ -x "$PROJECT_ROOT/scripts/start_proxies.sh" ]; then
    bash "$PROJECT_ROOT/scripts/start_proxies.sh" || fail "协议代理启动异常"
  else
    # 兼容旧路径
    if [ -x "$PROJECT_ROOT/forgemind/gemini_to_openroute_proxy.py" ]; then
      for spec in "gemini gemini_to_openroute_proxy.py 8082" "anthropic anthropic_to_openroute_proxy.py 8083" "responses responses_to_openroute_proxy.py 8084"; do
        set -- $spec
        name="$1"; file="$2"; port="$3"
        if curl -s -m 2 "http://127.0.0.1:${port}/health" >/dev/null 2>&1; then
          ok "${name} proxy 已在 ${port} 运行"
        else
          (cd "$PROJECT_ROOT" && setsid "$PY" "forgemind/${file}" --port "$port" > "logs/${name}_proxy.log" 2>&1 < /dev/null & disown)
          sleep 2
        fi
      done
    fi
  fi

  # 3.2 Claude Code Router (claude 多模型路由，端口 3456)
  if command -v ccr >/dev/null 2>&1; then
    if curl -s -m 2 http://127.0.0.1:3456/health >/dev/null 2>&1; then
      ok "claude-code-router 已在 3456 运行"
    else
      (setsid nohup ccr start -p 3456 > "$PROJECT_ROOT/logs/ccr.log" 2>&1 < /dev/null & disown)
      sleep 5
      curl -s -m 3 http://127.0.0.1:3456/health >/dev/null 2>&1 && ok "claude-code-router 启动成功" || fail "claude-code-router 启动失败（见 logs/ccr.log）"
    fi
  else
    fail "ccr（claude-code-router）未安装。已跳过其启动。"
  fi
}

# ---------------------------- Step 4 CLI 配置文件 ----------------------------
write_cli_configs() {
  section "Step 4: 写入 CLI 配置"
  # 4.1 Claude settings -> 指向 ccr router (3456)
  mkdir -p "$HOME/.claude"
  cat > "$HOME/.claude/settings.json" <<JSON
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:3456",
    "ANTHROPIC_AUTH_TOKEN": "${OPENROUTE_API_KEY}"
  },
  "includeCoAuthoredBy": false
}
JSON
  ok "已写入 ~/.claude/settings.json (Base URL -> ccr 3456)"

  # 4.1b claude-code-router 配置（openroute + openrouter 双供应商）
  mkdir -p "$HOME/.claude-code-router"
  "$PY" - "$HOME/.claude-code-router/config-router.json" "$OPENROUTE_GATEWAY" "$OPENROUTE_API_KEY" "$OPENROUTER_API_KEY" <<'PYEOF'
import json
import sys
import os

path, gateway, or_key, orr_key = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]

providers = {
    "codewhisperer-primary": {
        "type": "codewhisperer",
        "endpoint": "https://codewhisperer.us-east-1.amazonaws.com",
        "authentication": {"type": "bearer", "credentials": {}},
        "settings": {"categoryMappings": {"default": False, "background": False,
                                          "thinking": False, "longcontext": False, "search": False}},
    },
    "shuaihong-openai": {
        "type": "openai",
        "endpoint": "https://api.shuaihong.ai",
        "authentication": {"type": "bearer", "credentials": {"apiKey": "none"}},
        "settings": {"categoryMappings": {"default": False, "background": False,
                                          "thinking": False, "longcontext": False, "search": False}},
    },
    "openroute": {
        "type": "openai",
        "endpoint": f"{gateway}/chat/completions",
        "authentication": {"type": "bearer", "credentials": {"apiKey": or_key}},
        "settings": {"categoryMappings": {"default": True, "background": True,
                                          "thinking": True, "longcontext": True, "search": True},
                     "models": ["Doubao-Seed2.0", "DeepSeek-V4-Pro", "GLM-5.1", "Kimi-K2.6"],
                     "defaultModel": "Doubao-Seed2.0"},
    },
}
if orr_key:
    providers["openrouter"] = {
        "type": "openai",
        "endpoint": "https://openrouter.ai/api/v1/chat/completions",
        "authentication": {"type": "bearer", "credentials": {"apiKey": orr_key}},
        "settings": {"categoryMappings": {"default": True, "background": True,
                                          "thinking": True, "longcontext": True, "search": True},
                     "models": ["moonshotai/kimi-k2-instruct", "deepseek/deepseek-chat-v3-0324"],
                     "defaultModel": "moonshotai/kimi-k2-instruct"},
    }

config = {
    "server": {"port": 3456, "host": "127.0.0.1"},
    "routing": {
        "rules": [
            {"category": c, "provider": "openroute", "priority": 100}
            for c in ("default", "background", "thinking", "longcontext", "search")
        ],
        "defaultProvider": "openroute",
        "providers": providers,
    },
    "debug": {"enabled": True, "logLevel": "info", "traceRequests": True,
              "saveRequests": True, "logDir": os.path.expanduser("~/.claude-code-router/logs")},
    "hooks": [],
}
with open(path, "w", encoding="utf-8") as f:
    json.dump(config, f, indent=2, ensure_ascii=False)
print("OK")
PYEOF
  ok "已写入 ~/.claude-code-router/config-router.json (openroute + openrouter)"

  # 4.2 Codex 配置 -> OpenRoute responses 网关 (8084)
  mkdir -p "$HOME/.codex"
  cat > "$HOME/.codex/config.toml" <<TOML
model = "Doubao-Seed2.0"
model_provider = "openroute_responses"

[model_providers.openroute_responses]
name = "openroute_responses"
base_url = "http://127.0.0.1:8084/v1"
env_key = "CODEX_API_KEY"
wire_api = "responses"

sandbox_mode = "read-only"
TOML
  ok "已写入 ~/.codex/config.toml (responses proxy 8084)"

  # 4.3 iFlow settings -> OpenAI-Compatible API（openroute 网关）
  mkdir -p "$HOME/.iflow"
  cat > "$HOME/.iflow/settings.json" <<JSON
{
  "apiKey": "${OPENROUTE_API_KEY}",
  "baseUrl": "${OPENROUTE_GATEWAY}",
  "modelName": "Doubao-Seed2.0",
  "selectedAuthType": "openai-compatible"
}
JSON
  ok "已写入 ~/.iflow/settings.json (OpenAI-Compatible / openroute)"

  # 4.4 codebuddy 默认模型提示
  echo "  -> codebuddy 通过预置默认模型（hy3）工作，无需写入配置。"
  skip "qodercli 需要真实 Qoder 账号，请运行: qodercli login（浏览器授权）后可用。"
}

# ---------------------------- Step 5 一次性验证 ----------------------------
ping_test() {
  section "Step 5: CLI 一次性连通性验证（PONG）"
  if [ $NO_START -eq 1 ]; then
    skip "跳过（--no-start）"
    return 0
  fi
  export ANTHROPIC_AUTH_TOKEN="$OPENROUTE_API_KEY"
  # 验证 openroute/claude 等（每步 ~30-90s）
  if command -v claude >/dev/null 2>&1; then
    r="$(cd /tmp && timeout 90 claude -p "reply with exactly: PONG" 2>/dev/null | tail -1)"
    [[ "$r" == "PONG" ]] && ok "claude -> PONG" || warn "claude -> $r"
  fi
  if command -v codex >/dev/null 2>&1; then
    r="$(cd /tmp && CODEX_API_KEY="$OPENROUTE_API_KEY" timeout 90 codex exec --skip-git-repo-check "reply with exactly: PONG" 2>/dev/null | tail -1)"
    [[ "$r" == "PONG" ]] && ok "codex -> PONG" || warn "codex -> $r"
  fi
  if command -v opencode >/dev/null 2>&1; then
    r="$(cd /tmp && timeout 90 opencode run "reply with exactly: PONG" 2>/dev/null | tail -1)"
    [[ "$r" == "PONG" ]] && ok "opencode -> PONG" || warn "opencode -> $r"
  fi
  # 完整九灵智体验证留给 flowforge 服务
  if [ -x "$PROJECT_ROOT/scripts/verify_forgekin.py" ] && [ -x "$PROJECT_ROOT/.venv/bin/python" ]; then
    echo ""
    echo "  完整九灵智验证请运行:"
    echo "    $PROJECT_ROOT/.venv/bin/python $PROJECT_ROOT/scripts/verify_forgekin.py --live"
  fi
}
warn() { echo "  [WARN] $*"; }

# ---------------------------- 主流程 ----------------------------
main() {
  echo "=== FlowForge 三方编码智能体（CLI）一键部署 ==="
  check_gateway || true
  install_clis
  write_cli_configs
  if [ $ONLY_INSTALL -eq 1 ]; then
    section "完成（--only-install）"
    return 0
  fi
  start_infra
  ping_test
  section "部署完成"
  echo "运行完整九灵智体验证："
  echo "  $PROJECT_ROOT/.venv/bin/python $PROJECT_ROOT/scripts/verify_forgekin.py --live"
  echo "启动 flowforge 前后端："
  echo "  $PROJECT_ROOT/.venv/bin/python $PROJECT_ROOT/scripts/start.py"
}

main "$@"