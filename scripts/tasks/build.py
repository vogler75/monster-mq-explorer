"""`make.py build`: Electron packages (macOS / Windows / Linux), the PWA bundle and the Docker web build.

Replaces build.sh, build-mac.sh, build-win.sh, build-win.ps1, build-linux.sh, build-pwa.sh,
build-pwa.ps1 and build-docker.sh. Artifacts go where they always went: Electron packages to
release/ (electron-builder config in package.json), web bundles to dist/.
"""

import argparse
import os
import subprocess
from pathlib import Path
from typing import List, Optional

from mmqlib import proc, ui
from mmqlib.cli import Command
from mmqlib.proc import CommandError

from .common import PRODUCT, ensure_node_modules, host_arch, host_os, require_npm

ELECTRON_TARGETS = ("mac", "win", "linux")
ARTIFACT_PATTERNS = ("*.dmg", "*.exe", "*.zip", "*.AppImage", "*.deb")

DESCRIPTION = """\
Build MonsterMQ Explorer.

Without options it builds the Electron packages for every platform this OS can build
(same as the old build.sh): macOS, Windows and Linux into release/.

  --mac     macOS: .dmg (arm64 + x64) on macOS; on Linux only .zip (DMG needs macOS);
            not possible on Windows.
  --win     Windows: NSIS installer "MonsterMQ-Explorer Setup.exe" (x64); not on Linux.
  --linux   Linux: .AppImage + .deb for x64 and arm64. On non-x86_64 hosts the .deb needs a
            system fpm (else AppImage only). Not possible on Windows.
  --pwa     PWA bundle into dist/ (npm run build:pwa), checks manifest.webmanifest and sw.js.
  --docker  Web bundle into dist/ built inside a node:22-alpine container (npm ci && npm run build).
  --all     Same as the default: --mac --win --linux.

Targets the current OS cannot build are skipped with a notice. Electron builds and the
PWA/Docker builds all write dist/; when combined, the PWA build runs last so dist/ holds it.
"""


def _skip_reason(target: str, os_name: str) -> Optional[str]:
    if target == "mac" and os_name == "windows":
        return ("macOS packages cannot be built on Windows (electron-builder supports macOS "
                "builds only on macOS, and .zip-only builds on Linux). Build on a Mac.")
    if target == "win" and os_name == "linux":
        return "Skipping Windows Electron build on Linux (the Windows installer is built on Windows or macOS)."
    if target == "linux" and os_name == "windows":
        return ("Linux packages (.AppImage/.deb) cannot be built on Windows. "
                "Build on Linux (or macOS, or inside WSL).")
    return None


def _linux_targets(arch: str):
    """Linux targets plus extra env and an optional warning about skipped .deb packages.

    electron-builder's bundled fpm (used for .deb) only runs on x86_64. On other hosts use a
    system-installed fpm, or fall back to AppImage only.
    """
    if arch == "x86_64":
        return ["AppImage", "deb"], {}, None
    if proc.which("fpm"):
        return ["AppImage", "deb"], {"USE_SYSTEM_FPM": "true"}, None
    if not proc.which("ruby"):
        hint = ("Ruby and fpm are not installed. Install them with:\n"
                "    sudo apt install ruby ruby-dev build-essential\n"
                "    sudo gem install fpm")
    else:
        hint = "fpm is not installed. Install it with:\n    sudo gem install fpm"
    warning = (f"Skipping .deb packages: electron-builder's bundled fpm does not run on {arch}.\n"
               f"  {hint}\n"
               "  Then run 'python make.py build --linux' again to also build the .deb packages.")
    return ["AppImage"], {}, warning


def _electron_web_assets(root: Path) -> None:
    ui.step("Building web assets for Electron...")
    proc.run(["node", "scripts/set-version.cjs"], cwd=root)
    proc.run(["npx", "vite", "build"], cwd=root, env={"ELECTRON": "1"})


def _build_mac(root: Path, os_name: str) -> None:
    ui.step("Packaging macOS Electron app...")
    if os_name == "mac":
        proc.run(["npx", "electron-builder", "--mac"], cwd=root)
    else:
        ui.warn("Not running on macOS: building macOS .zip packages only "
                "(DMG requires macOS sips/hdiutil).")
        proc.run(["npx", "electron-builder", "--mac", "zip", "--arm64", "--x64"], cwd=root)


def _build_win(root: Path) -> None:
    ui.step("Packaging Windows Electron app...")
    proc.run(["npx", "electron-builder", "--win"], cwd=root)


def _build_linux(root: Path) -> Optional[str]:
    targets, env, warning = _linux_targets(host_arch())
    if warning:
        ui.warn(warning)
    ui.step(f"Packaging Linux Electron app ({' '.join(targets)})...")
    proc.run(["npx", "electron-builder", "--linux", *targets, "--x64", "--arm64"], cwd=root, env=env)
    return warning


def _build_pwa(root: Path) -> None:
    ui.step(f"[{PRODUCT}] Building PWA bundle...")
    for icon in ("icon-192.png", "icon-512.png"):
        if not (root / "public" / "icons" / icon).is_file():
            ui.warn(f"public/icons/{icon} is missing.")
    proc.run(["npm", "run", "build:pwa"], cwd=root)
    for generated in ("manifest.webmanifest", "sw.js"):
        if not (root / "dist" / generated).is_file():
            raise CommandError(["npm", "run", "build:pwa"], 1, f"dist/{generated} was not generated.")
    ui.ok("PWA bundle created successfully in dist/")
    ui.info("To test it locally, run: npm run preview")
    ui.info("Then open the app in a browser and use Install App / Add to Home Screen.")


def _build_docker(root: Path) -> None:
    docker = proc.which("docker")
    if not docker:
        raise CommandError(["docker"], 127, "docker was not found in PATH. Install Docker and try again.")
    info = subprocess.run([docker, "info"], cwd=root, capture_output=True)
    if info.returncode != 0:
        raise CommandError(["docker", "info"], 1, "the Docker daemon is not reachable. Start Docker and try again.")
    if host_os() != "linux":
        ui.warn("npm ci inside the Linux container replaces node_modules/ with Linux binaries. "
                "Run 'npm ci' on this machine afterwards before building natively again.")
    ui.step("Building web bundle (dist/) in node:22-alpine...")
    cmd: List[str] = ["docker", "run", "--rm", "-v", f"{root}:/app", "-w", "/app"]
    if hasattr(os, "getuid"):  # keep generated files owned by the host user (not available on Windows)
        cmd += ["-u", f"{os.getuid()}:{os.getgid()}"]
    cmd += ["node:22-alpine", "sh", "-c", "npm ci && npm run build"]
    proc.run(cmd, cwd=root)
    ui.ok("Web bundle created in dist/")


def _list_artifacts(root: Path) -> None:
    release = root / "release"
    files = sorted({p for pat in ARTIFACT_PATTERNS for p in release.glob(pat) if p.is_file()})
    if files:
        ui.info("Artifacts in release/:")
        for f in files:
            ui.info(f"  - {f.name}")


def main(root: Path, argv: List[str]) -> int:
    parser = argparse.ArgumentParser(prog="make.py build", description=DESCRIPTION,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--mac", action="store_true", help="macOS Electron app")
    parser.add_argument("--win", action="store_true", help="Windows Electron app")
    parser.add_argument("--linux", action="store_true", help="Linux Electron app")
    parser.add_argument("--pwa", action="store_true", help="PWA bundle in dist/")
    parser.add_argument("--docker", action="store_true", help="web bundle in dist/, built in Docker")
    parser.add_argument("--all", action="store_true", help="all Electron platforms (the default)")
    args = parser.parse_args(argv)

    electron = [t for t in ELECTRON_TARGETS if getattr(args, t)]
    if args.all or not (electron or args.pwa or args.docker):
        electron = list(ELECTRON_TARGETS)

    os_name = host_os()
    runnable, skipped = [], []
    for target in electron:
        reason = _skip_reason(target, os_name)
        if reason:
            ui.warn(reason)
            skipped.append(target)
        else:
            runnable.append(target)
    if not (runnable or args.pwa or args.docker):
        ui.error(f"nothing to build: {', '.join(skipped)} cannot be built on {os_name}")
        return 1
    if args.pwa and args.docker:
        ui.warn("--pwa and --docker both write dist/; the PWA build runs last and wins.")

    if runnable or args.pwa:
        require_npm()
        ensure_node_modules(root)

    warnings = []
    if runnable:
        _electron_web_assets(root)
        for target in runnable:
            if target == "mac":
                _build_mac(root, os_name)
            elif target == "win":
                _build_win(root)
            else:
                w = _build_linux(root)
                if w:
                    warnings.append(w)
    if args.docker:
        _build_docker(root)
    if args.pwa:
        _build_pwa(root)

    ui.info("")
    if runnable:
        _list_artifacts(root)
    for w in warnings:
        ui.warn(w)
    built = runnable + (["docker"] if args.docker else []) + (["pwa"] if args.pwa else [])
    ui.ok(f"Build complete: {', '.join(built)}" + (f" (skipped on {os_name}: {', '.join(skipped)})" if skipped else ""))
    return 0


def command(root: Path) -> Command:
    return Command("build Electron packages (--mac/--win/--linux), --pwa or --docker",
                   lambda argv: main(root, argv))
