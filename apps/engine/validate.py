#!/usr/bin/env python3
"""
validate.py - Python code validation script.
Equivalent to `npm run build` for Next.js.

Usage:
    poetry run python validate.py           # Full validation
    poetry run python validate.py --fix     # Auto-fix issues then validate
"""

import argparse
import io
import subprocess
import sys
from dataclasses import dataclass

# Force UTF-8 output on Windows so characters render correctly
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")

# ─── ANSI colors ─────────────────────────────────────────────────────────────
RESET  = "\033[0m"
BOLD   = "\033[1m"
GREEN  = "\033[32m"
RED    = "\033[31m"
YELLOW = "\033[33m"
CYAN   = "\033[36m"
DIM    = "\033[2m"


@dataclass
class CheckResult:
    name: str
    passed: bool
    output: str


def run(cmd: list[str]) -> tuple[int, str]:
    """Run a command and return (returncode, combined output)."""
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
    )
    output = result.stdout + result.stderr
    return result.returncode, output.strip()


def print_header():
    print(f"\n{BOLD}{CYAN}+------------------------------------------+{RESET}")
    print(f"{BOLD}{CYAN}|   AgentHive Engine -- Code Validator     |{RESET}")
    print(f"{BOLD}{CYAN}+------------------------------------------+{RESET}\n")


def print_step(index: int, total: int, name: str):
    print(f"{BOLD}[{index}/{total}] {name}{RESET}")


def print_result(result: CheckResult):
    if result.passed:
        print(f"  {GREEN}✓ PASSED{RESET}")
    else:
        print(f"  {RED}✗ FAILED{RESET}")
        if result.output:
            # Indent output for readability
            for line in result.output.splitlines():
                print(f"  {DIM}{line}{RESET}")
    print()


def check_ruff_lint(fix: bool = False) -> CheckResult:
    """Ruff: linting (pyflakes, pycodestyle, isort, bugbear, etc.)"""
    cmd = ["ruff", "check", ".", "--output-format=concise"]
    if fix:
        cmd.append("--fix")
    code, out = run(cmd)
    return CheckResult(name="Ruff Lint", passed=(code == 0), output=out)


def check_ruff_format(fix: bool = False) -> CheckResult:
    """Ruff: code formatting check."""
    cmd = ["ruff", "format", "."]
    if not fix:
        cmd.append("--check")
    code, out = run(cmd)
    return CheckResult(name="Ruff Format", passed=(code == 0), output=out)


def check_mypy() -> CheckResult:
    """Mypy: static type checking."""
    cmd = ["mypy", "app", "--no-error-summary"]
    code, out = run(cmd)
    return CheckResult(name="Mypy Type Check", passed=(code == 0), output=out)


def main():
    parser = argparse.ArgumentParser(description="Validate Python codebase.")
    parser.add_argument(
        "--fix",
        action="store_true",
        help="Auto-fix lint and formatting issues before checking.",
    )
    args = parser.parse_args()

    print_header()

    checks = [
        lambda: check_ruff_lint(fix=args.fix),
        lambda: check_ruff_format(fix=args.fix),
        lambda: check_mypy(),
    ]

    names = ["Ruff Lint (pyflakes, pycodestyle, isort, bugbear)", "Ruff Format", "Mypy Type Check"]
    total = len(checks)
    results: list[CheckResult] = []

    for i, (check_fn, name) in enumerate(zip(checks, names), start=1):
        print_step(i, total, name)
        result = check_fn()
        result.name = name
        results.append(result)
        print_result(result)

    # ─── Summary ─────────────────────────────────────────────────────────────
    passed = sum(1 for r in results if r.passed)
    failed = total - passed

    print(f"{BOLD}{'=' * 44}{RESET}")
    if failed == 0:
        print(f"{BOLD}{GREEN}  [OK] All {total} checks passed -- code is valid!{RESET}")
    else:
        print(f"{BOLD}{RED}  [FAIL] {failed}/{total} check(s) failed.{RESET}")
        if not args.fix:
            print(f"\n{YELLOW}  Tip: run with --fix to auto-fix lint & formatting issues.{RESET}")
            print(f"  {DIM}poetry run python validate.py --fix{RESET}")
    print(f"{BOLD}{'=' * 44}{RESET}\n")

    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
