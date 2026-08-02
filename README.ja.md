<div align="center">

# FlowForge

### Persistent Identity Agent Framework with Self-Devolution Loops
#### 永続的アイデンティティ・エージェント・フレームワーク · 自己進化ループ

[![CI](https://github.com/flowlight-ai/flowforge/actions/workflows/ci.yml/badge.svg)](https://github.com/flowlight-ai/flowforge/actions/workflows/ci.yml)
[![CodeQL](https://github.com/flowlight-ai/flowforge/actions/workflows/codeql.yml/badge.svg)](https://github.com/flowlight-ai/flowforge/actions/workflows/codeql.yml)
[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/downloads/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Code style: ruff](https://img.shields.io/badge/code%20style-ruff-000000.svg)](https://docs.astral.sh/ruff/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/flowlight-ai/flowforge/blob/main/CONTRIBUTING.md)
[![GitHub Discussions](https://img.shields.io/badge/GitHub-Discussions-purple.svg)](https://github.com/flowlight-ai/flowforge/discussions)

> *Forge a Persistent Identity. Endow it with Memory, Council, and Self-Devolution.*
> *永続的なアイデンティティを鍛造せよ。記憶・評議・自己進化の力を与えよ。*

</div>

---

[🇺🇸 English](README.md) · [🇨🇳 简体中文](README.zh-CN.md) · [🇯🇵 日本語](README.ja.md)

## なぜ FlowForge なのか？

主流のマルチエージェント・フレームワーク（AutoGen / CrewAI / LangGraph）は一つの問いにうまく答える。*セッション内で複数の LLM 呼び出しがどう協調するか* という問いだ。しかしセッションが終われば、エージェントは忘却する。サーバーを再起動すれば、白紙に戻る。モデルをアップグレードすれば、苦労して蓄積した経験は失われる。

FlowForge が答えるのは、より難しく、取り組む者が少ない問いだ。

> **エージェントはいかにして数ヶ月・複数のモデル世代をまたいで、アイデンティティを保ち、能力を蓄積し、検証可能性を維持し、ガバナンスのもとで進化し続けるのか？**

これはまた別のチャットボット・フレームワークではない。FlowForge は、長い時間軸で*記憶し、成長し、説明責任を負う*必要のあるエージェントのための**インフラ層**だ。

| 次元 | 主流マルチエージェント | FlowForge |
|------|------------------------|-----------|
| **アイデンティティ** | セッション単位；再起動で忘却 | セッション・クラッシュ・モデル更新をまたいで永続 |
| **能力** | 単一モデル + ツール呼び出し | モデル × ハーネス × Forgekin モルフォロジー × 外部エージェント拡張 |
| **協調** | 固定された役割枠（PM/開発/テスト） | 動的な能力プロファイル・ルーティング；役割は実行時のラベル |
| **進化** | モデル更新 = システム更新 | エージェントが自らのドキュメント・コード・テストを自律進化 |
| **レビュー** | 同一ベンダーの自己承認 | クロスベンダーの独立レビュー（自らの成果を承認できるエージェントはいない） |
| **具体化** | API ツール呼び出し | 物理センサー（IoT）+ 仮想世界設定 |

---

## 主な機能

- **永続的アイデンティティ（Forgekin / 霊智体）** — `Soul Imprint`（魂の刻印）、`Capability Profile`（能力プロファイル）、`EchoStore`（エコーストア）を持ち、クラッシュ・モデル更新・セッション境界を生き延びる長寿エージェント。
- **自己進化ループ（Self-Devolution Loops）** — ガバナンスの闸门のもと、エージェントが自らのドキュメント・コード・フレームワーク・レビュー・テストを自律進化させる 5 つの閉ループ。
- **クロスベンダー・レビュー** — レビュアーは作者と異なるベンダー出自でなければならない；自らの成果を承認できるエージェントはいない。
- **マルチドメイン記憶連邦** — `MindCodex` 手続き記憶法典を通じた 5 ドメインの記憶連邦。
- **7 層ハーネス・エンジニアリング** — `durable_state`（永続状態）・`tool_mediation`（ツール仲介）・`evidence_sensors`（証拠センシング）・`governance`（ガバナンス）・`magic_words`（魔法の言葉）・`entropy_control`（エントロピー制御）・`harnessability`（ハーネス可能性）。
- **設定駆動の Forgekin** — YAML プロファイルで任意の数の Forgekin を登録可能。デフォルトの 5 つは参考例であり、上限ではない。
- **外部エージェント統合** — Claude Code / Codex / Gemini / OpenCode / Trae CN を能力拡張としてバインド。

---

## Forgekins：設定可能な自己進化エージェント

**アーキテクチャは Forgekin の数に固定されていない。** Forgekin は設定駆動の実体だ。`config/forgekins/` に YAML プロファイルを置くだけで 1 つ登録でき、それを 1 つの自己進化ループに紐づけ、（オプションで）外部コーディング・エージェントに紐づける。ForgeMindEngine は実行時に能力プロファイルに基づいてタスクをルーティングし、役割をハードコードしない。

**建築の中心はエージェントの数ではなく、自己進化である。**

### 5 つのデフォルト Forgekin（参考例）

| Forgekin | ベンダー | 自己進化ループ | 外部エージェント |
|----------|--------|---------------|----------------|
| **Wenxin**（文心） | anthropic | ドキュメント進化 | Claude Code |
| **Sherlock**（夏洛克） | openai | コード進化 | Codex |
| **Vangogh**（梵高） | google | クロスベンダー・レビュー | Gemini |
| **Da Vinci**（ダ・ヴィンチ） | open_source | テスト進化 | OpenCode |
| **Luban**（魯班） | bytedance | フレームワーク進化 *（運用者承認必須）* | Trae CN |

### 自分の Forgekin を追加する

新しい Forgekin の登録は**純粋な設定作業**だ。フレームワーク・コードの変更は不要だ。

```yaml
# config/forgekins/my-forgekin.yaml
name: "MyForgekin"
vendor: anthropic
self_dev_loop: SelfDevCodeLoop
awakening_stage: E3
external_agent: claude_code
capabilities:
  - { name: "rust", proficiency: 0.8 }
  - { name: "system_design", proficiency: 0.6 }
blind_spots: ["frontend"]
```

---

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────────┐
│  Application Layer · forgemind/                                 │
│  Forgekin Registry · Council · External Agents                  │
├─────────────────────────────────────────────────────────────────┤
│  Command Layer · evolution/                                     │
│  ForgeMindEngine · Metacognition Router · Maturity Ladder       │
├─────────────────────────────────────────────────────────────────┤
│  Execution Layer · workers/ · loop/                             │
│  Self-Dev Loops · Loop Executor · Execution Modes               │
├─────────────────────────────────────────────────────────────────┤
│  Tools & Memory Layer · core/                                   │
│  capability · teamact · harness · memory · eval · reliability   │
└─────────────────────────────────────────────────────────────────┘
       ↕ Shared Kernel: DI Container · Plugin Protocol · Tracing ↕
```

**単方向依存**：上位層は下位層に依存する；下位層が上位層をインポートすることはない。

---

## クイックスタート

### ワンコマンド・セットアップ（推奨）

```bash
git clone https://github.com/flowlight-ai/flowforge.git
cd flowforge

# Python 環境の構築 + バックエンド依存のインストール + フロントエンドのビルド
python scripts/setup.py

# （オプション）外部コーディング・エージェント CLI のインストール
python scripts/install_agents.py

# バックエンド（8000 番ポート）+ フロントエンド（5175 番ポート）の起動
python scripts/start.py
```

その後、ブラウザで **http://localhost:5175** を開く。

### 手動セットアップ

> **パッケージ構成について**：リポジトリのルート*それ自体が* `flowforge` パッケージだ（トップレベルの `__init__.py` を含む）。バックエンド起動時、`flowforge.app.main` が正しく解決されるよう、リポジトリの**親**ディレクトリを `PYTHONPATH` に追加しなければならない。

```bash
pip install -e ".[dev]"
cd web && npm install && npm run build && cd ..

# 環境変数テンプレートをコピー
cp .env.example .env  # その後、キーを入力

# バックエンド起動（リポジトリルートが flowforge パッケージ → 親ディレクトリが PYTHONPATH 上）
export PYTHONPATH="$PWD/.."          # PowerShell: $env:PYTHONPATH = "$PWD\.."
python -m uvicorn flowforge.app.main:app --host 127.0.0.1 --port 8000

# フロントエンド起動（別ターミナル）
cd web && npm run dev
```

### 5 つのデフォルト Forgekin を検証

```bash
python scripts/verify_five_forgekins.py
```

**環境変数**（`.env.example` 参照）：

```
FLOWFORGE_WEBCHAT_TOKEN=...
FEISHU_APP_ID=...
FEISHU_APP_SECRET=...
FEISHU_CHAT_ID=...
```

---

## 設定

```yaml
# config/forgemind.yaml
external_agents:
  claude_code: { enabled: true, binary: "claude" }
  codex:       { enabled: true, binary: "codex" }
  gemini:      { enabled: true, binary: "gemini" }
  opencode:    { enabled: true, binary: "opencode" }
  trae:        { enabled: true, binary: "trae" }

council:
  min_reviewers: 2
  min_distinct_vendors: 2     # クロスベンダー強制
  pass_threshold: 0.85        # 品質閾値
```

各 Forgekin は `config/forgekins/*.yaml` 配下の YAML プロファイルで記述される。**フレームワークは Forgekin の数に上限を課さない** —— デプロイに合わせてプロファイルを追加・削除すればよい。

---

## ドキュメント

| ドキュメント | 説明 |
|------|------|
| [docs/VISION.md](docs/VISION.md) | プロジェクトのビジョンと設計哲学 |
| [docs/spec.md](docs/spec.md) | プロジェクト仕様 |
| [docs/arch.md](docs/arch.md) | アーキテクチャ設計 |
| [docs/design.md](docs/design.md) | 詳細設計 |
| [docs/roadmap.md](docs/roadmap.md) | 開発ロードマップ |
| [docs/decisions/](docs/decisions/) | アーキテクチャ決定記録（ADR） |
| [docs/features/](docs/features/) | 機能設計 |
| [docs/roleagent.md](docs/roleagent.md) | マルチエージェント工学パス |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 貢献ガイド |
| [SECURITY.md](SECURITY.md) | セキュリティポリシー |

---

## ロードマップ

| フェーズ | 範囲 | 状態 |
|------|------|------|
| **0** | プロジェクト・スキャフォールド + クロスプラットフォーム設定 + ドキュメント骨格 | ✅ 完了 |
| **1** | 7 つの工学パスのコード骨格 | 🔄 進行中（約 70%） |
| **2** | forgemind アプリケーション層 + Forgekin モルフォロジー | 🔄 進行中（約 85%） |
| **3** | サードパーティ・エージェント適応層 | 🔄 進行中（約 80%） |
| **4** | 評価自己代謝 + 分散信頼性 | 🔄 進行中（約 40%） |
| **5** | パートナーシップ数学 + 自己進化閉ループ | 🔄 進行中（約 60%） |
| **6** | SpiritForge 経験蒸留 + MindCouncil | 🔄 進行中（約 40%） |

詳細は [docs/roadmap.md](docs/roadmap.md) を参照。

---

## プロジェクト構造

```
flowforge/
├── core/              # 共有カーネル：capability · teamact · harness · memory · eval
├── evolution/         # ForgeMindEngine（自己進化オーケストレーション）
├── forgemind/         # アプリケーション層：forgekin · registry · council · external_agents
├── web/               # Web UI（Next.js 14 + FastAPI バックエンド）
├── config/            # forgemind.yaml · forgekins/*.yaml · evolution.yaml
├── docs/              # spec · arch · design · roadmap · ADR · features
├── scripts/           # setup.py · install_agents.py · start.py · verify_five_forgekins.py
└── tests/             # テストスイート
```

---

## 貢献

あらゆる種類の貢献を歓迎する —— 新しい Forgekin プロファイル、アダプター統合、ドキュメント改善、コア・フレームワークの作業。

- 🐛 [バグを報告](https://github.com/flowlight-ai/flowforge/issues/new?template=bug_report.yml)
- 💡 [機能提案](https://github.com/flowlight-ai/flowforge/issues/new?template=feature_request.yml)
- 💬 [ディスカッションに参加](https://github.com/flowlight-ai/flowforge/discussions)

Pull Request を開く前に [CONTRIBUTING.md](CONTRIBUTING.md) を読むこと。

---

## ライセンス

FlowForge は **[MIT ライセンス](LICENSE)** のもとで公開されている。

---

<div align="center">

**⭐ FlowForge が永続的アイデンティティ・エージェントの鍛造に役立ったら、ぜひスターをつけてください！ ⭐**

**[github.com/flowlight-ai/flowforge](https://github.com/flowlight-ai/flowforge)**

</div>
