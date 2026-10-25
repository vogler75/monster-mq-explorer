#!/usr/bin/env python3
"""MonsterMQ Explorer build, release and publish tool - run 'python make.py help'."""

import sys
from pathlib import Path

sys.dont_write_bytecode = True  # no __pycache__ in the tree; a release needs a clean working tree
ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "scripts"))

from mmqlib.cli import run_cli  # noqa: E402
from mmqlib.release import ReleaseConfig, release_commands  # noqa: E402
from tasks import build, publish, run  # noqa: E402

RELEASE = ReleaseConfig(
    name="MonsterMQ Explorer",
    # package.json follows the last release tag (scripts/set-version.cjs resets it on every
    # build), so only releases update it - writing a -dev version would dirty the tree on build.
    npm=True,
    npm_dev=False,
    next_steps=[
        "Build artifacts  : python make.py build",
        "Publish assets   : python make.py publish",
        "Next dev version : python make.py dev",
    ],
)

COMMANDS = {
    "build": build.command(ROOT),
    "run": run.command(ROOT),
    "publish": publish.command(ROOT),
    **release_commands(RELEASE, ROOT),
}

if __name__ == "__main__":
    sys.exit(run_cli("make.py", "MonsterMQ Explorer", COMMANDS))
