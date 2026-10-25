"""`make.py run`: start the app locally (replaces run.sh)."""

import argparse
from pathlib import Path
from typing import List

from mmqlib import proc
from mmqlib.cli import Command

from .common import ensure_node_modules

DESCRIPTION = """\
Run MonsterMQ Explorer locally.

Without options starts the Vite dev server (npm run dev).
  -b, --build      build first (npm run build), then run the production preview server
  -e, --electron   run the Electron preview app (npm run electron:preview); wins over -b
Arguments after '--' are passed on to the npm script.
"""


def main(root: Path, argv: List[str]) -> int:
    extra: List[str] = []
    if "--" in argv:
        i = argv.index("--")
        argv, extra = argv[:i], argv[i + 1:]
    parser = argparse.ArgumentParser(prog="make.py run", description=DESCRIPTION,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("-b", "--build", action="store_true", help="build, then run the preview server")
    parser.add_argument("-e", "--electron", action="store_true", help="run the Electron preview app")
    args = parser.parse_args(argv)

    ensure_node_modules(root)
    tail = ["--", *extra] if extra else []
    if args.electron:
        proc.run(["npm", "run", "electron:preview", *tail], cwd=root)
    elif args.build:
        proc.run(["npm", "run", "build"], cwd=root)
        proc.run(["npm", "run", "preview", *tail], cwd=root)
    else:
        proc.run(["npm", "run", "dev", *tail], cwd=root)
    return 0


def command(root: Path) -> Command:
    return Command("run the app: dev server, -b production preview, -e Electron",
                   lambda argv: main(root, argv))
