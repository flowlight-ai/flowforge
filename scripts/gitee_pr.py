#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gitee_pr.py - Gitee PR 管理（UTF-8 安全）

用法:
  python gitee_pr.py create --title "标题" --body-file body.txt --head feat/xxx --base master
  python gitee_pr.py update --number 49 --title "标题" --body-file body.txt
  python gitee_pr.py get --number 49

根本解决 PowerShell Invoke-RestMethod 中文乱码问题：
  使用 Python urllib，明确 UTF-8 编码，确保 Gitee API 收到正确中文。
"""

import argparse
import json
import os
import sys
import urllib.request
import urllib.error
from pathlib import Path

GITEE_API = "https://gitee.com/api/v5"
OWNER = os.environ.get("GITEE_OWNER", "flowlight-ai")
REPO = os.environ.get("GITEE_REPO", "flowforge")
TOKEN = os.environ.get("GITEE_TOKEN", "")

if not TOKEN:
    # 尝试从 .env 或 git config 读取（红线 11：禁止硬编码密钥）
    _env_file = Path(__file__).resolve().parent.parent / ".env"
    if _env_file.exists():
        for _line in _env_file.read_text(encoding="utf-8").split("\n"):
            _line = _line.strip()
            if _line.startswith("GITEE_TOKEN="):
                TOKEN = _line.split("=", 1)[1].strip().strip('"').strip("'")
                break
    if not TOKEN:
        print("错误: GITEE_TOKEN 未设置。请设置环境变量或在 .env 中配置 GITEE_TOKEN", file=sys.stderr)
        print("用法: set GITEE_TOKEN=your_token_here", file=sys.stderr)
        sys.exit(1)


def api_request(method, path, data=None):
    url = f"{GITEE_API}/repos/{OWNER}/{REPO}/{path}"
    if data is None:
        data = {}
    data["access_token"] = TOKEN
    body = json.dumps(data, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url, data=body, method=method,
        headers={"Content-Type": "application/json; charset=utf-8", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        print(f"HTTP Error {e.code}: {err_body}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"URL Error: {e.reason}", file=sys.stderr)
        sys.exit(1)


def create_pr(title, body, head, base):
    return api_request("POST", "pulls", {"title": title, "body": body, "head": head, "base": base})


def update_pr(number, title=None, body=None):
    data = {}
    if title: data["title"] = title
    if body: data["body"] = body
    return api_request("PATCH", f"pulls/{number}", data)


def get_pr(number):
    return api_request("GET", f"pulls/{number}")


def main():
    parser = argparse.ArgumentParser(description="Gitee PR 管理（UTF-8 安全）")
    sub = parser.add_subparsers(dest="command", required=True)

    p_create = sub.add_parser("create", help="创建 PR")
    p_create.add_argument("--title", required=True)
    p_create.add_argument("--body-file")
    p_create.add_argument("--body")
    p_create.add_argument("--head", required=True)
    p_create.add_argument("--base", default="master")

    p_update = sub.add_parser("update", help="更新 PR")
    p_update.add_argument("--number", type=int, required=True)
    p_update.add_argument("--title")
    p_update.add_argument("--body-file")
    p_update.add_argument("--body")

    p_get = sub.add_parser("get", help="获取 PR")
    p_get.add_argument("--number", type=int, required=True)

    args = parser.parse_args()

    if args.command == "create":
        body = ""
        if args.body_file:
            with open(args.body_file, "r", encoding="utf-8") as f:
                body = f.read()
        elif args.body:
            body = args.body
        result = create_pr(args.title, body, args.head, args.base)
        print(f"PR Created: {result.get('html_url', 'N/A')}")
        print(f"PR Number: {result.get('number', 'N/A')}")
    elif args.command == "update":
        body = None
        if args.body_file:
            with open(args.body_file, "r", encoding="utf-8") as f:
                body = f.read()
        elif args.body:
            body = args.body
        result = update_pr(args.number, args.title, body)
        print(f"PR Updated: {result.get('html_url', 'N/A')}")
    elif args.command == "get":
        result = get_pr(args.number)
        print(f"Title: {result.get('title', 'N/A')}")
        print(f"State: {result.get('state', 'N/A')}")
        print(f"URL: {result.get('html_url', 'N/A')}")
        print(f"Body:\n{result.get('body', 'N/A')}")


if __name__ == "__main__":
    main()
