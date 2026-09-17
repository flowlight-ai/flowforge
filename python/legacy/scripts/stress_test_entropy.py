#!/usr/bin/env python3
"""Stress test for DocGardener and DebtTracker under high-concurrency scenarios.

Simulates:
1. Rapid document registration and freshness checking
2. Concurrent debt recording and status updates
3. Mixed workload: doc updates + debt tracking simultaneously
4. Large-scale document set with linked source files

Usage:
    python flowforge/scripts/stress_test_entropy.py
    python flowforge/scripts/stress_test_entropy.py --iterations 500 --docs 200
"""

from __future__ import annotations

import asyncio
import os
import sys
import tempfile
import time
from pathlib import Path
from typing import List

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from flowforge.harness.entropy_manager import (
    DocGardener,
    DocEntry,
    DebtTracker,
    DebtSeverity,
    DebtStatus,
    EntropyManager,
)
from flowforge.core.task_context import TaskContext


# ── Color output helpers ─────────────────────────────────────────────────────

def green(msg: str) -> str:
    return f"\033[92m{msg}\033[0m"

def red(msg: str) -> str:
    return f"\033[91m{msg}\033[0m"

def yellow(msg: str) -> str:
    return f"\033[93m{msg}\033[0m"

def cyan(msg: str) -> str:
    return f"\033[96m{msg}\033[0m"

def bold(msg: str) -> str:
    return f"\033[1m{msg}\033[0m"


# ── Test scenarios ───────────────────────────────────────────────────────────

async def stress_doc_gardener(num_docs: int, iterations: int) -> dict:
    """Stress test DocGardener with rapid registration and freshness checks.

    Creates temp files, registers them as docs with linked sources,
    then repeatedly checks freshness while modifying source files.
    """
    print(bold("\n" + "=" * 72))
    print(bold("  STRESS TEST: DocGardener"))
    print(bold("=" * 72))
    print(f"  Docs: {num_docs}  Iterations: {iterations}")

    gardener = DocGardener(stale_threshold=0.5)
    tmpdir = tempfile.mkdtemp(prefix="docgardener_stress_")

    # Phase 1: Register documents
    t_register_start = time.time()
    doc_paths: List[str] = []
    source_paths: List[str] = []

    for i in range(num_docs):
        # Create doc file
        doc_path = os.path.join(tmpdir, f"doc_{i:04d}.md")
        with open(doc_path, "w") as f:
            f.write(f"# Documentation {i}\n\nThis is doc number {i}.\n")
        doc_paths.append(doc_path)

        # Create linked source files
        sources = set()
        for j in range(3):  # 3 sources per doc
            src_path = os.path.join(tmpdir, f"src_{i:04d}_{j}.py")
            with open(src_path, "w") as f:
                f.write(f"# Source module {i}-{j}\n\ndef func_{i}_{j}():\n    pass\n")
            sources.add(src_path)
        source_paths.extend(sources)

        gardener.register_doc(doc_path, linked_sources=sources)

    t_register_ms = (time.time() - t_register_start) * 1000
    print(f"\n  Phase 1: Registered {num_docs} docs with {num_docs * 3} sources "
          f"in {t_register_ms:.1f}ms")

    # Phase 2: Iterative freshness checks
    t_check_start = time.time()
    total_stale = 0
    check_times: List[float] = []

    for iteration in range(iterations):
        # Randomly modify some source files to trigger staleness
        if iteration % 5 == 0 and iteration > 0:
            # Modify 10% of source files
            modify_count = max(1, len(source_paths) // 10)
            for src in source_paths[:modify_count]:
                if os.path.exists(src):
                    with open(src, "a") as f:
                        f.write(f"\n# Modified at iteration {iteration}\n")
                    # Update mtime
                    os.utime(src, None)
            # Invalidate cache so next check sees the changes
            gardener.invalidate_cache()

        t_iter_start = time.time()
        stale = await gardener.check_freshness()
        t_iter_ms = (time.time() - t_iter_start) * 1000
        check_times.append(t_iter_ms)
        total_stale += len(stale)

    t_check_total_ms = (time.time() - t_check_start) * 1000

    # Stats
    avg_check_ms = sum(check_times) / len(check_times) if check_times else 0
    max_check_ms = max(check_times) if check_times else 0
    min_check_ms = min(check_times) if check_times else 0
    p95_idx = int(len(check_times) * 0.95)
    sorted_times = sorted(check_times)
    p95_check_ms = sorted_times[p95_idx] if p95_idx < len(sorted_times) else 0

    print(f"\n  Phase 2: {iterations} freshness checks completed")
    print(f"    Total time:       {t_check_total_ms:.1f}ms")
    print(f"    Avg per check:    {avg_check_ms:.2f}ms")
    print(f"    Min per check:    {min_check_ms:.2f}ms")
    print(f"    Max per check:    {max_check_ms:.2f}ms")
    print(f"    P95 per check:    {p95_check_ms:.2f}ms")
    print(f"    Total stale hits: {total_stale}")
    print(f"    Entries tracked:  {len(gardener.entries)}")

    # Cleanup
    import shutil
    shutil.rmtree(tmpdir, ignore_errors=True)

    result = {
        "scenario": "DocGardener",
        "num_docs": num_docs,
        "iterations": iterations,
        "register_ms": t_register_ms,
        "total_check_ms": t_check_total_ms,
        "avg_check_ms": avg_check_ms,
        "max_check_ms": max_check_ms,
        "p95_check_ms": p95_check_ms,
        "total_stale": total_stale,
        "passed": avg_check_ms < 500,  # Windows file I/O is slower; threshold: 500ms
    }

    status = green("PASS") if result["passed"] else red("FAIL")
    print(f"\n  Result: {status} (avg {avg_check_ms:.2f}ms per check, threshold: 500ms)")

    return result


async def stress_debt_tracker(num_items: int, iterations: int) -> dict:
    """Stress test DebtTracker with rapid recording and status updates.

    Records many debt items, updates their statuses, and queries
    open items and summaries repeatedly.
    """
    print(bold("\n" + "=" * 72))
    print(bold("  STRESS TEST: DebtTracker"))
    print(bold("=" * 72))
    print(f"  Items: {num_items}  Iterations: {iterations}")

    tracker = DebtTracker()

    # Phase 1: Record debt items
    t_record_start = time.time()
    item_ids: List[str] = []
    severities = [DebtSeverity.LOW, DebtSeverity.MEDIUM, DebtSeverity.HIGH, DebtSeverity.CRITICAL]

    for i in range(num_items):
        severity = severities[i % len(severities)]
        item_id = tracker.record(
            description=f"Technical debt item #{i}: placeholder description for stress testing",
            severity=severity,
            source="stress_test",
            metadata={"iteration": i, "batch": i // 100},
        )
        item_ids.append(item_id)

    t_record_ms = (time.time() - t_record_start) * 1000
    print(f"\n  Phase 1: Recorded {num_items} debt items in {t_record_ms:.1f}ms")

    # Phase 2: Status updates
    t_update_start = time.time()
    update_count = 0
    for i, item_id in enumerate(item_ids):
        if i % 3 == 0:
            tracker.update_status(item_id, DebtStatus.ACKNOWLEDGED)
            update_count += 1
        elif i % 5 == 0:
            tracker.update_status(item_id, DebtStatus.IN_PROGRESS)
            update_count += 1
        elif i % 7 == 0:
            tracker.update_status(item_id, DebtStatus.RESOLVED)
            update_count += 1

    t_update_ms = (time.time() - t_update_start) * 1000
    print(f"  Phase 2: Updated {update_count} items in {t_update_ms:.1f}ms")

    # Phase 3: Repeated queries
    t_query_start = time.time()
    query_times: List[float] = []

    for _ in range(iterations):
        t_iter_start = time.time()
        open_items = tracker.get_open_items()
        summary = tracker.get_summary()
        t_iter_ms = (time.time() - t_iter_start) * 1000
        query_times.append(t_iter_ms)

    t_query_total_ms = (time.time() - t_query_start) * 1000

    avg_query_ms = sum(query_times) / len(query_times) if query_times else 0
    max_query_ms = max(query_times) if query_times else 0
    p95_idx = int(len(query_times) * 0.95)
    sorted_times = sorted(query_times)
    p95_query_ms = sorted_times[p95_idx] if p95_idx < len(sorted_times) else 0

    summary = tracker.get_summary()
    print(f"\n  Phase 3: {iterations} queries completed")
    print(f"    Total time:       {t_query_total_ms:.1f}ms")
    print(f"    Avg per query:    {avg_query_ms:.2f}ms")
    print(f"    Max per query:    {max_query_ms:.2f}ms")
    print(f"    P95 per query:    {p95_query_ms:.2f}ms")
    print(f"    Total items:      {summary['total_items']}")
    print(f"    Open items:       {summary['open_items']}")
    print(f"    By severity:      {summary['by_severity']}")
    print(f"    By status:        {summary['by_status']}")

    result = {
        "scenario": "DebtTracker",
        "num_items": num_items,
        "iterations": iterations,
        "record_ms": t_record_ms,
        "update_ms": t_update_ms,
        "total_query_ms": t_query_total_ms,
        "avg_query_ms": avg_query_ms,
        "max_query_ms": max_query_ms,
        "p95_query_ms": p95_query_ms,
        "total_items": summary["total_items"],
        "passed": avg_query_ms < 50,  # Should be under 50ms per query
    }

    status = green("PASS") if result["passed"] else red("FAIL")
    print(f"\n  Result: {status} (avg {avg_query_ms:.2f}ms per query, threshold: 50ms)")

    return result


async def stress_concurrent_mixed(num_docs: int, num_debts: int, concurrency: int) -> dict:
    """Stress test with concurrent doc updates and debt tracking.

    Simulates real-world scenario where DocGardener and DebtTracker
    are used simultaneously from multiple async tasks.
    """
    print(bold("\n" + "=" * 72))
    print(bold("  STRESS TEST: Concurrent Mixed Workload"))
    print(bold("=" * 72))
    print(f"  Docs: {num_docs}  Debts: {num_debts}  Concurrency: {concurrency}")

    manager = EntropyManager(config={
        "doc_gardener_enabled": True,
        "debt_tracker_enabled": True,
        "rule_evolution_enabled": True,
    })

    tmpdir = tempfile.mkdtemp(prefix="entropy_stress_")

    # Prepare doc files
    doc_paths: List[str] = []
    for i in range(num_docs):
        doc_path = os.path.join(tmpdir, f"doc_{i:04d}.md")
        with open(doc_path, "w") as f:
            f.write(f"# Doc {i}\n")
        sources = set()
        for j in range(2):
            src = os.path.join(tmpdir, f"src_{i:04d}_{j}.py")
            with open(src, "w") as f:
                f.write(f"# Source {i}-{j}\n")
            sources.add(src)
        manager.doc_gardener.register_doc(doc_path, linked_sources=sources)
        doc_paths.append(doc_path)

    async def doc_check_task(task_id: int, rounds: int) -> dict:
        """Simulate repeated doc freshness checks with source modifications."""
        times: List[float] = []
        stale_count = 0
        for r in range(rounds):
            # Modify a random source file
            if r % 3 == 0:
                src_idx = (task_id * rounds + r) % (num_docs * 2)
                src_files = list(Path(tmpdir).glob("src_*.py"))
                if src_files:
                    target = src_files[src_idx % len(src_files)]
                    with open(target, "a") as f:
                        f.write(f"\n# Modified by task {task_id} round {r}\n")

            t_start = time.time()
            stale = await manager.doc_gardener.check_freshness()
            t_ms = (time.time() - t_start) * 1000
            times.append(t_ms)
            stale_count += len(stale)

            # Invalidate cache after modifications
            if r % 3 == 0:
                manager.doc_gardener.invalidate_cache()

        return {"task_id": task_id, "times": times, "stale_count": stale_count}

    async def debt_record_task(task_id: int, rounds: int) -> dict:
        """Simulate rapid debt recording and querying."""
        times: List[float] = []
        for r in range(rounds):
            t_start = time.time()
            manager.debt_tracker.record(
                description=f"Concurrent debt T{task_id}R{r}",
                severity=DebtSeverity.MEDIUM,
                source=f"stress_task_{task_id}",
            )
            _ = manager.debt_tracker.get_open_items()
            _ = manager.debt_tracker.get_summary()
            t_ms = (time.time() - t_start) * 1000
            times.append(t_ms)

        return {"task_id": task_id, "times": times}

    # Run concurrent tasks
    t_total_start = time.time()
    rounds_per_task = 10

    doc_tasks = [doc_check_task(i, rounds_per_task) for i in range(concurrency)]
    debt_tasks = [debt_record_task(i, rounds_per_task) for i in range(concurrency)]

    doc_results = await asyncio.gather(*doc_tasks)
    debt_results = await asyncio.gather(*debt_tasks)

    t_total_ms = (time.time() - t_total_start) * 1000

    # Aggregate stats
    all_doc_times = [t for r in doc_results for t in r["times"]]
    all_debt_times = [t for r in debt_results for t in r["times"]]
    total_stale = sum(r["stale_count"] for r in doc_results)

    avg_doc_ms = sum(all_doc_times) / len(all_doc_times) if all_doc_times else 0
    avg_debt_ms = sum(all_debt_times) / len(all_debt_times) if all_debt_times else 0
    max_doc_ms = max(all_doc_times) if all_doc_times else 0
    max_debt_ms = max(all_debt_times) if all_debt_times else 0

    debt_summary = manager.debt_tracker.get_summary()

    print(f"\n  Concurrent execution completed in {t_total_ms:.1f}ms")
    print(f"  DocGardener:")
    print(f"    Total checks:     {len(all_doc_times)}")
    print(f"    Avg per check:    {avg_doc_ms:.2f}ms")
    print(f"    Max per check:    {max_doc_ms:.2f}ms")
    print(f"    Total stale hits: {total_stale}")
    print(f"  DebtTracker:")
    print(f"    Total operations: {len(all_debt_times)}")
    print(f"    Avg per op:       {avg_debt_ms:.2f}ms")
    print(f"    Max per op:       {max_debt_ms:.2f}ms")
    print(f"    Total items:      {debt_summary['total_items']}")
    print(f"    Open items:       {debt_summary['open_items']}")

    # Cleanup
    import shutil
    shutil.rmtree(tmpdir, ignore_errors=True)

    result = {
        "scenario": "Concurrent Mixed",
        "concurrency": concurrency,
        "total_ms": t_total_ms,
        "avg_doc_ms": avg_doc_ms,
        "avg_debt_ms": avg_debt_ms,
        "max_doc_ms": max_doc_ms,
        "max_debt_ms": max_debt_ms,
        "total_debt_items": debt_summary["total_items"],
        "passed": max_doc_ms < 500 and max_debt_ms < 100,  # Reasonable thresholds
    }

    status = green("PASS") if result["passed"] else red("FAIL")
    print(f"\n  Result: {status} (max_doc={max_doc_ms:.1f}ms, max_debt={max_debt_ms:.1f}ms)")

    return result


async def stress_entropy_manager_check(num_docs: int) -> dict:
    """Stress test EntropyManager.check() with full pipeline.

    Creates a TaskContext with violations and runs the full check pipeline.
    """
    print(bold("\n" + "=" * 72))
    print(bold("  STRESS TEST: EntropyManager.check() Full Pipeline"))
    print(bold("=" * 72))
    print(f"  Docs: {num_docs}")

    manager = EntropyManager(config={
        "doc_gardener_enabled": True,
        "debt_tracker_enabled": True,
        "rule_evolution_enabled": True,
    })

    tmpdir = tempfile.mkdtemp(prefix="entropy_check_stress_")

    # Register docs
    for i in range(num_docs):
        doc_path = os.path.join(tmpdir, f"doc_{i:04d}.md")
        with open(doc_path, "w") as f:
            f.write(f"# Doc {i}\n")
        sources = set()
        for j in range(2):
            src = os.path.join(tmpdir, f"src_{i:04d}_{j}.py")
            with open(src, "w") as f:
                f.write(f"# Source {i}-{j}\n")
            sources.add(src)
        manager.doc_gardener.register_doc(doc_path, linked_sources=sources)

    # Create context with violations
    ctx = TaskContext(
        task_id="stress-check-001",
        input_data={"query": "stress test"},
        persona="stress_tester",
        mode="autonomous",
    )
    ctx.state["harness_violations"] = [
        {"violation": f"Layer violation #{i}", "source": "stress_test"}
        for i in range(50)
    ]
    ctx.state["linter_violations"] = [
        {"rule_name": f"LINT-{i:03d}", "description": f"Linter issue {i}", "severity": "error" if i % 3 == 0 else "warning"}
        for i in range(30)
    ]

    # Run check
    t_start = time.time()
    result = await manager.check(ctx)
    t_ms = (time.time() - t_start) * 1000

    print(f"\n  Full pipeline check completed in {t_ms:.1f}ms")
    print(f"    Doc freshness:    {result['doc_freshness']['stale_count']} stale docs")
    print(f"    Debt summary:     {result['debt_summary']['total_items']} total, "
          f"{result['debt_summary']['open_items']} open")
    print(f"    Active rules:     {result['active_rules_count']}")
    print(f"    GC result:        {len(result['gc_result']['collected'])} types collected")

    # Cleanup
    import shutil
    shutil.rmtree(tmpdir, ignore_errors=True)

    result_data = {
        "scenario": "EntropyManager.check()",
        "num_docs": num_docs,
        "total_ms": t_ms,
        "debt_items": result["debt_summary"]["total_items"],
        "passed": t_ms < 2000,  # Should complete in under 2s
    }

    status = green("PASS") if result_data["passed"] else red("FAIL")
    print(f"\n  Result: {status} (total {t_ms:.1f}ms, threshold: 2000ms)")

    return result_data


# ── Main ─────────────────────────────────────────────────────────────────────

async def main():
    import argparse
    parser = argparse.ArgumentParser(description="Stress test DocGardener and DebtTracker")
    parser.add_argument("--iterations", type=int, default=100, help="Number of iterations")
    parser.add_argument("--docs", type=int, default=100, help="Number of documents")
    parser.add_argument("--debts", type=int, default=500, help="Number of debt items")
    parser.add_argument("--concurrency", type=int, default=10, help="Concurrent tasks")
    args = parser.parse_args()

    print(bold(cyan("\n" + "=" * 72)))
    print(bold(cyan("  FlowForge v6.0 Entropy Module Stress Test")))
    print(bold(cyan("=" * 72)))
    print(f"  Timestamp: {time.strftime('%Y-%m-%d %H:%M:%S')}")

    results = []

    # Run all scenarios
    results.append(await stress_doc_gardener(args.docs, args.iterations))
    results.append(await stress_debt_tracker(args.debts, args.iterations))
    results.append(await stress_concurrent_mixed(args.docs, args.debts, args.concurrency))
    results.append(await stress_entropy_manager_check(args.docs))

    # Summary
    print(bold(cyan("\n" + "=" * 72)))
    print(bold(cyan("  SUMMARY")))
    print(bold(cyan("=" * 72)))

    all_passed = True
    for r in results:
        status = green("PASS") if r["passed"] else red("FAIL")
        print(f"  {status}  {r['scenario']}")
        if not r["passed"]:
            all_passed = False

    print()
    if all_passed:
        print(bold(green("  ALL STRESS TESTS PASSED")))
    else:
        print(bold(red("  SOME STRESS TESTS FAILED")))

    return 0 if all_passed else 1


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
