"""FlowForge 安全扫描工具 — OWASP依赖检查、SAST模式分析、OWASP Top 10检查。"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput


class SecurityScannerTool(BaseTool):
    name: str = "security_scanner"
    description: str = "Execute security scans: OWASP dependency check, SAST, and pattern-based analysis"
    parameters_schema: dict[str, Any] = {
        "type": "object",
        "required": ["action"],
        "properties": {
            "action": {
                "type": "string",
                "enum": ["dependency_check", "sast", "owasp"],
            },
            "files": {"type": "array", "items": {"type": "string"}},
            "rules": {"type": "object"},
            "cwd": {"type": "string"},
        },
    }

    DANGEROUS_PATTERNS: dict[str, dict[str, str]] = {
        "eval(": {"severity": "critical", "description": "Use of eval() allows arbitrary code execution"},
        "exec(": {"severity": "critical", "description": "Use of exec() allows arbitrary code execution"},
        "os.system(": {"severity": "high", "description": "Use of os.system() is susceptible to command injection"},
        "subprocess.call(": {"severity": "high", "description": "Unsanitized subprocess.call() may allow command injection"},
        "subprocess.Popen(": {"severity": "high", "description": "Unsanitized subprocess.Popen() may allow command injection"},
        "pickle.loads(": {"severity": "critical", "description": "Use of pickle.loads() allows arbitrary code execution"},
        "yaml.load(": {"severity": "high", "description": "Use of yaml.load() without Loader is unsafe"},
        "marshal.loads(": {"severity": "critical", "description": "Use of marshal.loads() allows arbitrary code execution"},
        "shelve.open(": {"severity": "medium", "description": "Use of shelve.open() may expose pickle vulnerabilities"},
        "tempfile.mktemp(": {"severity": "high", "description": "Use of mktemp() is vulnerable to race conditions"},
        "hashlib.md5(": {"severity": "medium", "description": "MD5 is cryptographically broken"},
        "hashlib.sha1(": {"severity": "medium", "description": "SHA-1 is cryptographically weak"},
        "ssl._create_unverified_context(": {"severity": "high", "description": "Disables SSL certificate verification"},
        "requests.get(verify=False)": {"severity": "high", "description": "Disables SSL verification in requests"},
    }

    async def execute(self, input: ToolInput) -> ToolOutput:
        action: str = input.params.get("action", "")

        if action == "dependency_check":
            return await self._dependency_check(input.params)
        elif action == "sast":
            return await self._sast(input.params)
        elif action == "owasp":
            return await self._owasp(input.params)
        else:
            return ToolOutput(
                result={"success": False},
                error=f"Unknown action: {action}. Supported: dependency_check, sast, owasp",
            )

    async def _dependency_check(self, params: dict[str, Any]) -> ToolOutput:
        cwd: str = params.get("cwd", ".")
        rules: dict[str, Any] = params.get("rules", {})

        cmd: list[str] = ["pip", "audit", "--format=json"]

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                cwd=cwd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate()
            raw_output: str = stdout.decode("utf-8", errors="replace")

            vulnerabilities: list[dict[str, Any]] = []
            if raw_output.strip():
                try:
                    audit_data: list[dict[str, Any]] = json.loads(raw_output)
                    for dep in audit_data:
                        for vuln in dep.get("vulns", []):
                            vulnerabilities.append({
                                "package": dep.get("name", "unknown"),
                                "version": dep.get("version", "unknown"),
                                "vulnerability_id": vuln.get("id", ""),
                                "description": vuln.get("description", ""),
                                "severity": self._classify_cvss(vuln.get("fix_versions", [])),
                            })
                except json.JSONDecodeError:
                    vulnerabilities = self._parse_text_vulns(raw_output)

            summary: dict[str, int] = self._summarize_severity(vulnerabilities)
            score: float = self._compute_score(summary)

            return ToolOutput(result={
                "success": True,
                "scanner": "pip_audit",
                "score": round(score, 4),
                "vulnerability_count": len(vulnerabilities),
                "summary": summary,
                "vulnerabilities": vulnerabilities[:100],
            })
        except FileNotFoundError:
            return ToolOutput(
                result={"success": False},
                error="pip-audit not found. Install it with: pip install pip-audit",
            )
        except Exception as e:
            return ToolOutput(result={"success": False}, error=str(e))

    async def _sast(self, params: dict[str, Any]) -> ToolOutput:
        files: list[str] = params.get("files", [])
        cwd: str = params.get("cwd", ".")
        rules: dict[str, Any] = params.get("rules", {})

        custom_patterns: dict[str, dict[str, str]] = rules.get("patterns", {})
        all_patterns: dict[str, dict[str, str]] = {**self.DANGEROUS_PATTERNS, **custom_patterns}

        vulnerabilities: list[dict[str, Any]] = []

        if not files:
            files = await self._find_python_files(cwd)

        for filepath in files:
            try:
                source = Path(filepath).read_text(encoding="utf-8", errors="replace")
            except Exception:
                continue

            for line_num, line in enumerate(source.splitlines(), 1):
                for pattern, info in all_patterns.items():
                    if pattern in line:
                        vulnerabilities.append({
                            "file": filepath,
                            "line": line_num,
                            "pattern": pattern,
                            "severity": info["severity"],
                            "description": info["description"],
                            "code_snippet": line.strip()[:200],
                        })

        summary: dict[str, int] = self._summarize_severity(vulnerabilities)
        score: float = self._compute_score(summary)

        return ToolOutput(result={
            "success": True,
            "scanner": "pattern_sast",
            "score": round(score, 4),
            "vulnerability_count": len(vulnerabilities),
            "summary": summary,
            "vulnerabilities": vulnerabilities[:100],
        })

    async def _owasp(self, params: dict[str, Any]) -> ToolOutput:
        files: list[str] = params.get("files", [])
        cwd: str = params.get("cwd", ".")
        rules: dict[str, Any] = params.get("rules", {})

        owasp_checks: dict[str, dict[str, Any]] = {
            "A01_broken_access_control": self._check_access_control,
            "A02_cryptographic_failures": self._check_crypto,
            "A03_injection": self._check_injection,
            "A05_security_misconfiguration": self._check_misconfig,
            "A07_identification_auth_failures": self._check_auth,
        }

        results: dict[str, list[dict[str, Any]]] = {}
        all_findings: list[dict[str, Any]] = []

        if not files:
            files = await self._find_python_files(cwd)

        sources: dict[str, str] = {}
        for filepath in files:
            try:
                sources[filepath] = Path(filepath).read_text(encoding="utf-8", errors="replace")
            except Exception:
                continue

        for check_name, check_fn in owasp_checks.items():
            findings: list[dict[str, Any]] = check_fn(sources, rules)
            results[check_name] = findings
            all_findings.extend(findings)

        summary: dict[str, int] = self._summarize_severity(all_findings)
        score: float = self._compute_score(summary)

        return ToolOutput(result={
            "success": True,
            "scanner": "owasp_pattern",
            "score": round(score, 4),
            "total_findings": len(all_findings),
            "summary": summary,
            "checks": {k: len(v) for k, v in results.items()},
            "findings": all_findings[:100],
        })

    async def _find_python_files(self, cwd: str) -> list[str]:
        cmd: list[str] = ["git", "ls-files", "*.py"]
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                cwd=cwd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await proc.communicate()
            if proc.returncode == 0:
                return [f.strip() for f in stdout.decode("utf-8", errors="replace").splitlines() if f.strip()]
        except Exception:
            pass
        return ["."]

    def _check_access_control(self, sources: dict[str, str], rules: dict[str, Any]) -> list[dict[str, Any]]:
        findings: list[dict[str, Any]] = []
        for filepath, source in sources.items():
            if "@public" in source or "allow_anyone" in source:
                findings.append({
                    "file": filepath,
                    "severity": "high",
                    "category": "A01",
                    "description": "Potential broken access control detected",
                })
        return findings

    def _check_crypto(self, sources: dict[str, str], rules: dict[str, Any]) -> list[dict[str, Any]]:
        findings: list[dict[str, Any]] = []
        for filepath, source in sources.items():
            if "hashlib.md5(" in source or "hashlib.sha1(" in source:
                findings.append({
                    "file": filepath,
                    "severity": "medium",
                    "category": "A02",
                    "description": "Weak cryptographic algorithm detected",
                })
            if "hardcoded" in source.lower() and "key" in source.lower():
                findings.append({
                    "file": filepath,
                    "severity": "high",
                    "category": "A02",
                    "description": "Potential hardcoded cryptographic key",
                })
        return findings

    def _check_injection(self, sources: dict[str, str], rules: dict[str, Any]) -> list[dict[str, Any]]:
        findings: list[dict[str, Any]] = []
        for filepath, source in sources.items():
            if "eval(" in source or "exec(" in source:
                findings.append({
                    "file": filepath,
                    "severity": "critical",
                    "category": "A03",
                    "description": "Code injection risk via eval/exec",
                })
            if "f\"" in source and ("SELECT" in source or "INSERT" in source or "DELETE" in source):
                findings.append({
                    "file": filepath,
                    "severity": "high",
                    "category": "A03",
                    "description": "Potential SQL injection via f-string interpolation",
                })
        return findings

    def _check_misconfig(self, sources: dict[str, str], rules: dict[str, Any]) -> list[dict[str, Any]]:
        findings: list[dict[str, Any]] = []
        for filepath, source in sources.items():
            if "DEBUG = True" in source:
                findings.append({
                    "file": filepath,
                    "severity": "medium",
                    "category": "A05",
                    "description": "Debug mode enabled in production config",
                })
            if "CORS_ALLOW_ALL" in source or "allow_origins=['*']" in source:
                findings.append({
                    "file": filepath,
                    "severity": "high",
                    "category": "A05",
                    "description": "Overly permissive CORS configuration",
                })
        return findings

    def _check_auth(self, sources: dict[str, str], rules: dict[str, Any]) -> list[dict[str, Any]]:
        findings: list[dict[str, Any]] = []
        for filepath, source in sources.items():
            if "password" in source.lower() and "plain" in source.lower():
                findings.append({
                    "file": filepath,
                    "severity": "high",
                    "category": "A07",
                    "description": "Potential plaintext password handling",
                })
            if "session_expiry" not in source and "session" in source.lower():
                findings.append({
                    "file": filepath,
                    "severity": "medium",
                    "category": "A07",
                    "description": "Session without explicit expiry configuration",
                })
        return findings

    def _classify_cvss(self, fix_versions: list[Any]) -> str:
        if not fix_versions:
            return "high"
        return "medium"

    def _parse_text_vulns(self, output: str) -> list[dict[str, Any]]:
        vulnerabilities: list[dict[str, Any]] = []
        for line in output.strip().splitlines():
            if line.strip():
                vulnerabilities.append({"raw": line.strip(), "severity": "unknown"})
        return vulnerabilities

    def _summarize_severity(self, vulnerabilities: list[dict[str, Any]]) -> dict[str, int]:
        summary: dict[str, int] = {"critical": 0, "high": 0, "medium": 0, "low": 0}
        for vuln in vulnerabilities:
            severity: str = vuln.get("severity", "low").lower()
            if severity in summary:
                summary[severity] += 1
            else:
                summary["low"] += 1
        return summary

    def _compute_score(self, summary: dict[str, int]) -> float:
        deductions: float = (
            summary.get("critical", 0) * 0.3
            + summary.get("high", 0) * 0.2
            + summary.get("medium", 0) * 0.1
            + summary.get("low", 0) * 0.02
        )
        return max(0.0, 1.0 - deductions)
