# FlowForge Harness Eval 反馈

> **文档编号**: harness-feedback/README.md（v1.0）
> **依据**: `[doc:roleagent.md#第5章]` Eval 自代谢系统
> **参考**: `[doc:clowder-ai/docs/harness-feedback/]` 目录结构

---

## 1. 用途

本目录存放 FlowForge Harness Eval 反馈数据，与设计文档分离。Eval 结果驱动文档自我演进（`[doc:review/review.md#12.3]` 自我演进三层架构）。

---

## 2. 目录结构

```
harness-feedback/
├── README.md                          # 本文件
├── bundles/                           # Eval 结果打包（按日期）
│   └── YYYY-MM-DD-eval-<domain>/      # 单次 Eval 包
│       ├── snapshot.json              # 状态快照
│       ├── attribution.json           # 归因结果
│       └── provenance.json            # 出处溯源
├── eval-domains/                      # Eval 域定义（YAML）
│   ├── eval-a2a.yaml                  # A2A 协作 eval
│   ├── eval-memory.yaml               # 记忆召回 eval
│   ├── eval-forgemind.yaml            # 万物灵智体 eval
│   ├── eval-external-agent.yaml       # 三方 Agent eval
│   └── eval-friction.yaml             # 摩擦信号 eval
└── verdicts/                          # Eval 裁决记录
    └── YYYY-MM-DD-eval-<domain>-<slug>.md
```

---

## 3. Eval 域定义

### 3.1 eval-a2a.yaml — A2A 协作 eval

评估 TeamAct 协作：交接胶囊完整度、五项终止条件达成度、跨厂商 review 有效性、乒乓球熔断器触发频率。

### 3.2 eval-memory.yaml — 记忆召回 eval

评估多域记忆联邦：三入口检索准确率、消费加权排序有效性、记忆治理三要素执行度。

### 3.3 eval-forgemind.yaml — 万物灵智体 eval

评估灵智体锻造：5 种形态灵智体创建正确性、传感器接入稳定性、虚拟世界设定一致性、形态进化合法性。

### 3.4 eval-external-agent.yaml — 三方 Agent eval

评估三方 Agent 集成：4 个 Agent 调用成功率、能力画像融合正确性、fallback 链有效性、状态共享一致性。

### 3.5 eval-friction.yaml — 摩擦信号 eval

评估灵智体协作摩擦：返工率、跨厂商盲点检出率、用户可见崩塌率、波动吸收因子。

---

## 4. Eval 数据生命周期

```
1. Feature 执行 → trace 数据采集
   ↓
2. 三方信号交叉（trace + 用户反馈 + 自动探针）
   ↓
3. 归因到七类矩阵之一
   ↓
4. 打包到 bundles/YYYY-MM-DD-eval-<domain>/
   ↓
5. 裁决记录到 verdicts/
   ↓
6. 触发文档自我演进（更新 features/F0XX.md 状态）
   ↓
7. 触发代码自我演进（Build to Delete sunset / Built to Persist 加固）
   ↓
8. 触发框架自我演进（ForgekinEngine 路由策略优化）
```

---

## 5. Eval 数据格式

### 5.1 snapshot.json

```json
{
  "eval_id": "2026-07-17-eval-forgemind-cat-creation",
  "timestamp": "2026-07-17T10:30:00Z",
  "domain": "forgemind",
  "forgekin_id": "cat-001",
  "feature_id": "F027",
  "trace_id": "trace-xxx",
  "state_snapshot": {
    "teamact_step": "Verdict",
    "termination_conditions": {
      "acceptance_met": true,
      "evidence_attached": true,
      "cross_agent_verified": true,
      "no_dangling_ownership": true,
      "vision_converged": true
    }
  }
}
```

### 5.2 attribution.json

```json
{
  "eval_id": "2026-07-17-eval-forgemind-cat-creation",
  "attribution_class": "harness_misalignment",
  "confidence": 0.87,
  "evidence": [
    {"signal": "trace", "value": "CapabilityProfile.gap_analysis skipped"},
    {"signal": "user_feedback", "value": "灵智体未识别猫的习性"},
    {"signal": "probe", "value": "memory_recall_accuracy=0.42"}
  ],
  "recommended_action": "refactor_harness"
}
```

### 5.3 provenance.json

```json
{
  "eval_id": "2026-07-17-eval-forgemind-cat-creation",
  "evaluator_agent_id": "eval-agent-001",
  "model": "Qwen3.6-Plus",
  "input_files": ["trace-xxx.jsonl", "user-feedback-xxx.json"],
  "eval_contract_version": "1.0",
  "scripts": ["eval/forgemind_eval.py@v1.2"]
}
```

---

## 6. Eval 数据治理

- **不可变性**：bundles/ 数据写入后不可修改（审计要求）
- **保留期**：verdicts/ 永久保留；bundles/ 保留 90 天
- **隐私**：用户反馈数据脱敏后存储
- **可检索**：所有 Eval 数据通过灵典 Mind Codex 可检索（`[doc:features/F039-mind-codex-searchable.md]`）
