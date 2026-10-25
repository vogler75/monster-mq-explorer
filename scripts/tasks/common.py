"""Helpers shared by the Explorer tasks."""

import platform
import sys
from pathlib import Path

from mmqlib import proc, ui
from mmqlib.proc import CommandError

PRODUCT = "MonsterMQ-Explorer"


def host_os() -> str:
    """'mac', 'windows' or 'linux' (anything else is reported as-is)."""
    if sys.platform == "darwin":
        return "mac"
    if sys.platform.startswith("win"):
        return "windows"
    if sys.platform.startswith("linux"):
        return "linux"
    return sys.platform


def host_arch() -> str:
    """Normalized CPU architecture: 'x86_64', 'arm64' or the raw machine name."""
    machine = platform.machine().lower()
    if machine in ("x86_64", "amd64", "x64"):
        return "x86_64"
    if machine in ("arm64", "aarch64"):
        return "arm64"
    return machine or "unknown"


def require_npm() -> None:
    if not proc.which("npm"):
        raise CommandError(["npm"], 127, "npm was not found in PATH.\n"
                           "Install Node.js and npm, then run this command again.")


def ensure_node_modules(root: Path) -> None:
    """Install dependencies when node_modules is missing (same as the old scripts: npm install)."""
    require_npm()
    if not (root / "package.json").is_file():
        raise CommandError(["npm"], 1, f"package.json not found in {root}")
    if not (root / "node_modules").is_dir():
        ui.step("Installing dependencies (node_modules not found)...")
        proc.run(["npm", "install"], cwd=root)
