"""`make.py publish`: upload the built packages in release/ to the GitHub release (replaces publish.sh
and the upload part of build-win.ps1 -u).

Never creates, moves or pushes a tag: the tag v<version> must already exist on the remote and point
at HEAD (use `make.py release` / `make.py retag`). Uploads are idempotent (--clobber), so re-running
after a network failure just completes the job.
"""

import argparse
import re
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional

from mmqlib import proc, ui
from mmqlib.cli import Command
from mmqlib.git import Git, GitError
from mmqlib.version import Version, VersionError, read_version_file

from .common import PRODUCT

PATTERNS = ("*.dmg", "*.exe", "*.zip", "*.AppImage", "*.deb")

DESCRIPTION = """\
Upload the built packages in release/ (.dmg, .exe, .zip, .AppImage, .deb) to the GitHub release
v<version>, where <version> comes from version.txt. Creates the GitHub release if it does not
exist yet (notes from releases/v<version>.txt when present), otherwise replaces the assets.

Refuses when version.txt holds a dev version, when the tag is missing on the remote or does
not point at HEAD, when gh is not logged in, or when the electron-builder metadata
(release/latest*.yml) was built for another version.
"""


class PublishError(Exception):
    pass


@dataclass
class Plan:
    version: Version
    tag: str
    files: List[Path]
    notes_file: Optional[Path]
    warnings: List[str] = field(default_factory=list)


def find_artifacts(release_dir: Path) -> List[Path]:
    files: List[Path] = []
    for pattern in PATTERNS:
        for f in sorted(release_dir.glob(pattern)):
            if f.is_file() and not f.name.endswith(".blockmap") and f not in files:
                files.append(f)
    return files


_YML_VERSION = re.compile(r"^version:\s*['\"]?([^'\"\s]+)", re.MULTILINE)


def built_versions(release_dir: Path) -> dict:
    """Versions recorded by electron-builder in release/latest*.yml, by file name."""
    found = {}
    for yml in sorted(release_dir.glob("latest*.yml")):
        m = _YML_VERSION.search(yml.read_text(encoding="utf-8", errors="replace"))
        if m:
            found[yml.name] = m.group(1)
    return found


def make_plan(root: Path, git: Git, remote: str) -> Plan:
    """All read-only checks except gh; raises PublishError on the first problem."""
    try:
        version = Version.parse(read_version_file(root / "version.txt"))
    except VersionError as e:
        raise PublishError(str(e))
    if version.is_prerelease:
        raise PublishError(f"version.txt holds the development version {version}; GitHub releases are "
                           "only published for released versions. Run 'python make.py release' first.")
    tag = version.tag

    head = git.head()
    remote_tags = git.remote_tags(remote)
    if tag not in remote_tags:
        hint = ("it exists locally only - run 'python make.py status' / 'python make.py repair' to push it"
                if git.rev_parse(f"refs/tags/{tag}") else "run 'python make.py release' first")
        raise PublishError(f"tag {tag} does not exist on {remote}; {hint}.")
    tagged = remote_tags[tag].commit
    if tagged != head:
        raise PublishError(
            f"tag {tag} on {remote} points at {tagged[:9]}, but HEAD is {head[:9]}.\n"
            f"Publish from the tagged commit (git checkout {tag}, then build and publish), or move the "
            "tag to HEAD with 'python make.py retag'. publish never moves or force-pushes tags.")

    release_dir = root / "release"
    files = find_artifacts(release_dir)
    if not files:
        raise PublishError("no release files found in release/. Build first: python make.py build "
                           "(or build --mac / --win / --linux).")

    warnings = []
    built = built_versions(release_dir)
    wrong = {name: v for name, v in built.items() if v != str(version)}
    if wrong:
        details = ", ".join(f"{n} says {v}" for n, v in wrong.items())
        raise PublishError(f"release/ contains packages built for another version ({details}; expected "
                           f"{version}). Rebuild with 'python make.py build' on the tagged commit.")
    if not built:
        warnings.append("no release/latest*.yml found; cannot verify the version embedded in the packages")

    notes = root / "releases" / f"{tag}.txt"
    return Plan(version, tag, files, notes if notes.is_file() else None, warnings)


def gh(args: List[str], root: Path, capture: bool = True) -> subprocess.CompletedProcess:
    exe = proc.which("gh")
    if not exe:
        raise PublishError("GitHub CLI (gh) not found. Install it: https://cli.github.com "
                           "(winget install GitHub.cli / brew install gh).")
    if not capture:
        ui.detail("$ gh " + " ".join(args))
        return subprocess.run([exe, *args], cwd=str(root))
    return subprocess.run([exe, *args], cwd=str(root), capture_output=True, text=True,
                          encoding="utf-8", errors="replace")


def check_gh(root: Path) -> None:
    status = gh(["auth", "status"], root)
    if status.returncode != 0:
        raise PublishError("gh is not logged in to GitHub (gh auth status failed). Run 'gh auth login'.\n"
                           + (status.stderr or status.stdout).strip())


def release_exists(root: Path, tag: str) -> bool:
    view = gh(["release", "view", tag, "--json", "tagName"], root)
    if view.returncode == 0:
        return True
    if "not found" in (view.stderr or "").lower():
        return False
    raise PublishError(f"could not query GitHub release {tag}: {(view.stderr or view.stdout).strip()}")


def main(root: Path, argv: List[str]) -> int:
    parser = argparse.ArgumentParser(prog="make.py publish", description=DESCRIPTION,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("-n", "--dry-run", action="store_true",
                        help="run all checks and show what would be uploaded, upload nothing")
    parser.add_argument("--remote", default="origin", help="git remote holding the tag (default: origin)")
    args = parser.parse_args(argv)

    try:
        plan = make_plan(root, Git(root), args.remote)
        check_gh(root)  # before anything is uploaded
        exists = release_exists(root, plan.tag)

        for w in plan.warnings:
            ui.warn(w)
        ui.info(f"[publish] {PRODUCT} {plan.tag} - {'updating existing' if exists else 'creating'} GitHub release")
        for f in plan.files:
            ui.info(f"  - release/{f.name}")
        if args.dry_run:
            ui.ok("dry run: nothing uploaded")
            return 0

        files = [str(f) for f in plan.files]
        if exists:
            ui.step(f"Release {plan.tag} exists - uploading assets...")
            result = gh(["release", "upload", plan.tag, *files, "--clobber"], root, capture=False)
        else:
            ui.step(f"Creating release {plan.tag}...")
            notes = (["--notes-file", str(plan.notes_file)] if plan.notes_file
                     else ["--notes", f"Release {plan.tag}"])
            # --verify-tag: never let gh create a missing tag.
            result = gh(["release", "create", plan.tag, *files, "--verify-tag",
                         "--title", f"{PRODUCT} {plan.tag}", *notes], root, capture=False)
        if result.returncode != 0:
            raise PublishError(f"upload failed (exit {result.returncode}); re-run 'python make.py publish' "
                               "to complete it - uploads replace existing assets.")
        url = gh(["release", "view", plan.tag, "--json", "url", "-q", ".url"], root)
        ui.ok(f"Released {plan.tag} to GitHub: {url.stdout.strip()}")
        return 0
    except (PublishError, GitError) as e:
        ui.error(str(e))
        return 1


def command(root: Path) -> Command:
    return Command("upload release/ packages to the GitHub release of the current tag",
                   lambda argv: main(root, argv))
