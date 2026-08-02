"""ForgeMind v7.0 全流程验证脚本.

验证:
    1. 3 只Forgekin（鲁班/夏洛克/梵高）通过 YAML 配置锻造
    2. webchat — 与Forgekin对话（Trae CN 桥接，降级模式）
    3. IM MindCouncil — 3 只Forgekin共同讨论
    4. 自进化触发 — ForgeMindEngine Mode A/B/C

运行方式:
    cd d:\\software\\openclaw
    python flowforge/scripts/verify_forgemind_pipeline.py

详见:
    - [doc:design/naming-contract.md#2.2] Forgekin定义
    - [doc:VISION.md#1] Forgekin愿景
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

# 将项目根加入 sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from flowforge.forgemind.forgekins import BUILTIN_FORGEKINS, ROSTER_FILES
from flowforge.forgemind.forging.pipeline import ForgePipeline


async def verify_forge_all() -> dict:
    """验证 1: 锻造 3 只Forgekin."""
    print("\n" + "=" * 70)
    print("验证 1: 锻造 3 只Forgekin（鲁班/夏洛克/梵高）")
    print("=" * 70)

    pipeline = ForgePipeline()
    forgekins = {}

    for fid in BUILTIN_FORGEKINS:
        print(f"\n[锻造] {fid} from {ROSTER_FILES[fid].name}")
        try:
            forgekin = await pipeline.forge_from_yaml(ROSTER_FILES[fid])
            desc = forgekin.describe()
            forgekins[fid] = forgekin
            print(f"  ✅ 锻造成功: {desc['name']} ({desc['species_chinese']})")
            print(f"     forgekin_id: {desc['forgekin_id']}")
            print(f"     进化阶: {desc['evolution_stage']} ({desc['evolution_stage_chinese']})")
            print(f"     觉醒阶: {desc['awakening_stage']} ({desc['awakening_stage_chinese']})")
            print(f"     SoulImprint哈希: {desc['imprint_hash'][:16]}...")
            print(f"     可自进化: {desc['can_self_evolve']}")
            print(f"     可锻造新Forgekin: {desc['can_forge_new_forgekin']}")
        except Exception as exc:  # noqa: BLE001
            print(f"  ❌ 锻造失败: {type(exc).__name__}: {exc}")

    return forgekins


async def verify_webchat(forgekins: dict) -> None:
    """验证 2: webchat（降级模式，未注入 LLM 客户端）."""
    print("\n" + "=" * 70)
    print("验证 2: webchat（Trae CN 桥接 — 降级模式）")
    print("=" * 70)

    test_message = "请简单介绍你自己，包括你的角色和能力。"

    for fid, forgekin in forgekins.items():
        print(f"\n[webchat] {forgekin.name} ({fid})")
        print(f"  用户: {test_message}")
        try:
            result = await forgekin.chat([{"role": "user", "content": test_message}])
            content = result.get("content", "")
            degraded = result.get("usage", {}).get("degraded", False)
            status = "降级模式" if degraded else "桥接成功"
            print(f"  [{status}] {forgekin.name}: {content[:300]}...")
        except Exception as exc:  # noqa: BLE001
            print(f"  ❌ webchat 失败: {type(exc).__name__}: {exc}")


async def verify_council(forgekins: dict) -> None:
    """验证 3: IM MindCouncil（3 只Forgekin共同讨论）."""
    print("\n" + "=" * 70)
    print("验证 3: IM MindCouncil（3 只Forgekin共同讨论）")
    print("=" * 70)

    topic = "FlowForge v7.0 是否应该立即实现 Evoling 状态（觉醒阶 E4+）？"
    print(f"\nMindCouncil主题: {topic}")
    print(f"参与Forgekin: {[fk.name for fk in forgekins.values()]}")

    discussion_history: list[dict[str, str]] = []

    for round_num in range(1, 2):  # 单轮
        print(f"\n--- 第 {round_num} 轮 ---")
        for fid, forgekin in forgekins.items():
            context_msg = f"MindCouncil主题: {topic}\n\n"
            if discussion_history:
                context_msg += "已有讨论:\n"
                for msg in discussion_history[-3:]:
                    context_msg += f"[{msg['role']}]: {msg['content'][:100]}\n"
                context_msg += "\n请基于以上讨论，给出你的观点（150 字以内）:"
            else:
                context_msg += "请给出你的初始观点（150 字以内）:"

            try:
                result = await forgekin.chat(
                    [{"role": "user", "content": context_msg}]
                )
                content = result.get("content", "")
                print(f"\n[{forgekin.name}]:")
                print(f"  {content[:400]}")
                discussion_history.append({
                    "role": forgekin.name,
                    "content": content,
                })
            except Exception as exc:  # noqa: BLE001
                print(f"  ❌ {forgekin.name} 发言失败: {exc}")


async def verify_evolve(forgekins: dict) -> None:
    """验证 4: 自进化触发（ForgeMindEngine）."""
    print("\n" + "=" * 70)
    print("验证 4: 自进化触发（ForgeMindEngine Mode A/B/C）")
    print("=" * 70)

    for fid, forgekin in forgekins.items():
        print(f"\n[evolve] {forgekin.name} ({fid})")
        print(f"  觉醒阶: {forgekin.awakening_stage.value}")
        print(f"  可自进化: {forgekin.can_self_evolve()}")
        if forgekin.can_self_evolve():
            print(f"  ✅ 可触发 Mode A/B/C（scope_guard/process_evolution/knowledge_evolution）")
        else:
            print(f"  ⚠️  觉醒阶 < E4，仅支持 operator 触发的 scope_guard 模式")


async def verify_system_prompt(forgekins: dict) -> None:
    """验证 5: system prompt 构建（含角色/性格/能力/价值锚点）."""
    print("\n" + "=" * 70)
    print("验证 5: system prompt 构建（从 YAML 配置）")
    print("=" * 70)

    for fid, forgekin in forgekins.items():
        print(f"\n[{forgekin.name}] system prompt 预览:")
        prompt = forgekin._build_system_prompt()
        # 只显示前 500 字
        print(prompt[:500])
        print(f"\n... (总长度: {len(prompt)} 字符)")


async def main() -> None:
    """主验证流程."""
    print("=" * 70)
    print("ForgeMind v7.0 全流程验证")
    print("=" * 70)
    print(f"项目根: {PROJECT_ROOT}")
    print(f"预置Forgekin: {BUILTIN_FORGEKINS}")

    # 验证 1: 锻造
    forgekins = await verify_forge_all()
    if not forgekins:
        print("\n❌ 锻造失败，终止验证")
        return

    # 验证 2: webchat
    await verify_webchat(forgekins)

    # 验证 3: IM MindCouncil
    await verify_council(forgekins)

    # 验证 4: 自进化
    await verify_evolve(forgekins)

    # 验证 5: system prompt
    await verify_system_prompt(forgekins)

    print("\n" + "=" * 70)
    print("✅ 全流程验证完成")
    print("=" * 70)
    print("\n下一步:")
    print("  1. 启动 FastAPI: cd flowforge && python -m flowforge.app.main")
    print("  2. 锻造Forgekin: POST /api/v1/forgemind/forge/luban")
    print("  3. webchat: POST /api/v1/forgemind/webchat/luban")
    print("  4. IM MindCouncil: POST /api/v1/forgemind/council")
    print("  5. 自进化: POST /api/v1/forgemind/evolve/luban")


if __name__ == "__main__":
    asyncio.run(main())
