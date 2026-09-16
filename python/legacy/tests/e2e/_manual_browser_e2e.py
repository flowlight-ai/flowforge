"""Manual browser E2E audit (T8 iron rule): real Chromium, real DOM.

Usage:
    .venv/Scripts/python tests/e2e/_manual_browser_e2e.py

Launches headless Chromium, visits every frontend route against the live
frontend (http://127.0.0.1:5174) backed by the live backend (http://127.0.0.1:8000).
Listeners are attached ONCE; per-route lists are reset each iteration so
console/page-error counts are NOT inflated by listener accumulation.

Records per route: HTTP status, uncaught page exceptions, console errors,
white-screen / "Application error" crash markers, key DOM assertions, and
failed backend requests (status >= 400) with their URLs.

Output -> /tmp/ff_e2e_report.json (evidence for bug filing).
"""
from __future__ import annotations

import json
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

FRONTEND = "http://127.0.0.1:5174"
BACKEND = "http://127.0.0.1:8000"
SHOT_DIR = Path("/tmp/ff_e2e_shots")
SHOT_DIR.mkdir(parents=True, exist_ok=True)

ROUTES = [
    "/", "/solo", "/council", "/mission-control", "/mission-hub",
    "/memory", "/memory/catalog", "/memory/graph", "/memory/health",
    "/memory/search", "/memory/status", "/review", "/tasks", "/signals",
    "/signals/sources", "/admin", "/admin/agents", "/admin/autonomous",
    "/admin/co-creators", "/admin/env", "/admin/governance", "/admin/im",
    "/admin/marketplace", "/admin/mcp", "/admin/models", "/admin/notify",
    "/admin/observability", "/admin/permissions", "/admin/plugins",
    "/admin/quotas", "/admin/routing", "/admin/settings", "/admin/tools",
]

ROUTE_ASSERT = {
    "/solo": ["textarea", "input[type=text]", "input[placeholder]"],
    "/mission-hub": ["main", "body"],
    "/review": ["main", "body"],
    "/tasks": ["main", "body"],
    "/memory": ["main", "body"],
    "/admin": ["main", "body"],
    "/council": ["main", "body"],
}


def audit():
    report = {"frontend": FRONTEND, "backend": BACKEND, "routes": [],
              "start": time.time()}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        # dismiss first-run overlays up front
        page.goto(FRONTEND + "/", wait_until="domcontentloaded", timeout=60000)
        page.evaluate("try{localStorage.setItem('flowforge.firstrun.done','1');"
                      "localStorage.setItem('flowforge-guide-completed','true')"
                      "}catch(e){}")
        # single listeners, shared buffers
        console_buf: list = []
        page_err_buf: list = []
        failed_req: list = []

        def on_console(msg):
            console_buf.append({"type": msg.type, "text": msg.text[:300]})

        def on_pageerr(exc):
            page_err_buf.append(str(exc)[:300])

        def on_response(r):
            if r.status >= 400:
                failed_req.append({"status": r.status, "url": r.url})

        page.on("console", on_console)
        page.on("pageerror", on_pageerr)
        page.on("response", on_response)

        for route in ROUTES:
            console_buf.clear()
            page_err_buf.clear()
            failed_req.clear()
            entry = {"route": route, "status": None, "crash": False,
                     "dom_ok": None, "assertions": [], "failed_req": []}
            try:
                resp = page.goto(FRONTEND + route, wait_until="load", timeout=45000)
                entry["status"] = resp.status if resp else None
            except Exception as e:  # noqa
                entry["goto_error"] = str(e)[:300]
            page.wait_for_timeout(2500)
            body_text = ""
            try:
                body_text = page.inner_text("body") or ""
            except Exception:  # noqa
                body_text = ""
            crash_markers = ["Application error", "Internal Server Error",
                             "This page could not be found",
                             "Unhandled Runtime Error"]
            entry["crash"] = any(m in body_text for m in crash_markers)
            entry["body_len"] = len(body_text.strip())
            asserts = ROUTE_ASSERT.get(route)
            if asserts:
                for sel in asserts:
                    try:
                        el = page.query_selector(sel)
                        visible = bool(el and el.is_visible())
                    except Exception:  # noqa
                        visible = False
                    entry["assertions"].append({"sel": sel, "visible": visible})
                entry["dom_ok"] = any(a["visible"] for a in entry["assertions"])
            try:
                shot = SHOT_DIR / (route.replace("/", "_") or "_root") + ".png"
                page.screenshot(path=str(shot), full_page=False)
                entry["shot"] = str(shot)
            except Exception:  # noqa
                pass
            entry["console"] = list(console_buf)
            entry["page_errors"] = list(page_err_buf)
            entry["console_errors"] = [c for c in console_buf
                                       if c["type"] == "error"]
            entry["failed_req"] = list(failed_req)
            report["routes"].append(entry)
            print(f"[route] {route:26s} status={entry['status']} "
                  f"crash={entry['crash']} body={entry['body_len']} "
                  f"cerr={len(entry['console_errors'])} "
                  f"perr={len(page_err_buf)} failreq={len(failed_req)}",
                  flush=True)
        browser.close()
    report["end"] = time.time()
    report["duration_s"] = round(report["end"] - report["start"], 1)
    Path("/tmp/ff_e2e_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    crashes = [r["route"] for r in report["routes"] if r.get("crash")]
    perr = [(r["route"], r["page_errors"]) for r in report["routes"]
            if r.get("page_errors")]
    print("\n===== SUMMARY =====")
    print(f"routes: {len(report['routes'])}")
    print(f"crashes: {crashes}")
    print("uncaught exceptions per route:")
    for rt, errs in perr:
        print(f"  {rt}: {len(errs)}")
    print(f"report -> /tmp/ff_e2e_report.json")
    return report


if __name__ == "__main__":
    audit()
