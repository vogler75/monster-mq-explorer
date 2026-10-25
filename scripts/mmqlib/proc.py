"""Running external commands the same way on Windows, macOS and Linux."""

import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Union

from . import ui

PathLike = Union[str, Path]


class CommandError(Exception):
    def __init__(self, cmd: Sequence[str], returncode: int, output: str = ""):
        self.cmd = list(cmd)
        self.returncode = returncode
        self.output = output.strip()
        msg = f"command failed (exit {returncode}): {' '.join(self.cmd)}"
        if self.output:
            msg += f"\n{self.output}"
        super().__init__(msg)


def which(name: str) -> Optional[str]:
    """Resolve a tool on PATH, including Windows wrappers like npm.cmd or mvn.cmd."""
    return shutil.which(name)


def require(name: str) -> str:
    path = which(name)
    if path is None:
        raise CommandError([name], 127, f"'{name}' not found on PATH")
    return path


def run(cmd: Sequence[PathLike], cwd: Optional[PathLike] = None, echo: bool = True,
        check: bool = True, env: Optional[Dict[str, str]] = None) -> int:
    """Run a command with output streaming to the console. Never uses a shell.

    `env` holds extra environment variables, added to the current environment.
    """
    args: List[str] = [str(c) for c in cmd]
    exe = which(args[0])
    if exe:
        args[0] = exe
    if echo:
        prefix = "".join(f"{k}={v} " for k, v in (env or {}).items())
        ui.detail("$ " + prefix + " ".join(str(c) for c in cmd))
    full_env = {**os.environ, **env} if env else None
    sys.stdout.flush()  # keep our output in order with the child's when piped
    sys.stderr.flush()
    proc = subprocess.run(args, cwd=cwd, env=full_env)
    if check and proc.returncode != 0:
        raise CommandError(args, proc.returncode)
    return proc.returncode


def capture(cmd: Sequence[PathLike], cwd: Optional[PathLike] = None, check: bool = True) -> str:
    """Run a command and return its stdout (stripped)."""
    args = [str(c) for c in cmd]
    exe = which(args[0])
    if exe:
        args[0] = exe
    proc = subprocess.run(args, cwd=cwd, capture_output=True, text=True,
                          encoding="utf-8", errors="replace")
    if check and proc.returncode != 0:
        raise CommandError(args, proc.returncode, proc.stderr or proc.stdout)
    return proc.stdout.strip()
