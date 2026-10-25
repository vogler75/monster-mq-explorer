"""Tests for the make.py tasks (publish checks, build target selection). gh is always mocked.

Run from the repo root:  python -m unittest discover -s scripts/tests -v
"""

import contextlib
import io
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tasks import build, publish  # noqa: E402


def sh(cwd, *args) -> str:
    proc = subprocess.run(["git", *args], cwd=str(cwd), capture_output=True, text=True)
    if proc.returncode != 0:
        raise AssertionError(f"git {' '.join(args)} failed: {proc.stderr}")
    return proc.stdout.strip()


class FakeGh:
    """Records gh calls; never talks to GitHub."""

    def __init__(self, auth_ok=True, release_exists=False):
        self.auth_ok = auth_ok
        self.release_exists = release_exists
        self.calls = []

    def __call__(self, args, root, capture=True):
        self.calls.append(list(args))
        rc, out, err = 0, "", ""
        if args[:2] == ["auth", "status"] and not self.auth_ok:
            rc, err = 1, "You are not logged into any GitHub hosts."
        elif args[:2] == ["release", "view"] and "url" not in args and not self.release_exists:
            rc, err = 1, "release not found"
        elif args[:2] == ["release", "view"] and "url" in args:
            out = "https://example.invalid/release"
        return subprocess.CompletedProcess(args, rc, out, err)

    def uploads(self):
        return [c for c in self.calls if c[:2] in (["release", "upload"], ["release", "create"])]


class PublishTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="mmq-publish-test-"))
        origin = self.tmp / "origin.git"
        sh(self.tmp, "init", "--bare", "-b", "main", str(origin))
        sh(self.tmp, "clone", "-q", str(origin), "work")
        self.work = self.tmp / "work"
        sh(self.work, "config", "user.name", "Test")
        sh(self.work, "config", "user.email", "test@example.com")
        (self.work / "version.txt").write_text("v1.2.3\n")  # legacy leading 'v' must still parse
        sh(self.work, "add", ".")
        sh(self.work, "commit", "-m", "init")
        sh(self.work, "tag", "-a", "v1.2.3", "-m", "v1.2.3")
        sh(self.work, "push", "-q", "origin", "main", "refs/tags/v1.2.3")
        rel = self.work / "release"
        rel.mkdir()
        (rel / "MonsterMQ-Explorer Setup.exe").write_bytes(b"exe")
        (rel / "MonsterMQ-Explorer Setup.exe.blockmap").write_bytes(b"map")
        (rel / "latest.yml").write_text("version: 1.2.3\npath: x\n")
        self.output = ""

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def publish(self, gh, *argv) -> int:
        out = io.StringIO()
        with mock.patch.object(publish, "gh", gh), \
                contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            code = publish.main(self.work, list(argv))
        self.output = out.getvalue()
        return code

    def test_creates_release_with_verify_tag(self):
        gh = FakeGh()
        self.assertEqual(self.publish(gh), 0, self.output)
        (create,) = gh.uploads()
        self.assertEqual(create[:3], ["release", "create", "v1.2.3"])
        self.assertIn("--verify-tag", create)
        self.assertTrue(any(a.endswith("Setup.exe") for a in create))
        self.assertFalse(any(a.endswith(".blockmap") for a in create))

    def test_existing_release_uploads_with_clobber(self):
        gh = FakeGh(release_exists=True)
        self.assertEqual(self.publish(gh), 0, self.output)
        (upload,) = gh.uploads()
        self.assertEqual(upload[:3], ["release", "upload", "v1.2.3"])
        self.assertIn("--clobber", upload)

    def test_dry_run_uploads_nothing(self):
        gh = FakeGh()
        self.assertEqual(self.publish(gh, "--dry-run"), 0, self.output)
        self.assertEqual(gh.uploads(), [])

    def test_refuses_dev_version(self):
        (self.work / "version.txt").write_text("1.2.4-dev\n")
        gh = FakeGh()
        self.assertEqual(self.publish(gh), 1)
        self.assertIn("development version", self.output)
        self.assertEqual(gh.calls, [])

    def test_refuses_tag_missing_on_origin(self):
        (self.work / "version.txt").write_text("1.2.4\n")
        sh(self.work, "tag", "-a", "v1.2.4", "-m", "local only")
        self.assertEqual(self.publish(FakeGh()), 1)
        self.assertIn("does not exist on origin", self.output)
        self.assertIn("exists locally only", self.output)

    def test_refuses_tag_not_at_head(self):
        (self.work / "x.txt").write_text("x\n")
        sh(self.work, "add", "x.txt")
        sh(self.work, "commit", "-m", "after release")
        gh = FakeGh()
        self.assertEqual(self.publish(gh), 1)
        self.assertIn("retag", self.output)
        self.assertEqual(gh.uploads(), [])
        # the remote tag was not touched
        self.assertEqual(sh(self.work, "ls-remote", "--tags", "origin", "v1.2.3^{}").split()[0],
                         sh(self.work, "rev-parse", "HEAD~1"))

    def test_refuses_artifacts_of_other_version(self):
        (self.work / "release" / "latest.yml").write_text("version: 1.2.2\n")
        gh = FakeGh()
        self.assertEqual(self.publish(gh), 1)
        self.assertIn("another version", self.output)
        self.assertEqual(gh.calls, [])

    def test_refuses_without_artifacts(self):
        shutil.rmtree(self.work / "release")
        self.assertEqual(self.publish(FakeGh()), 1)
        self.assertIn("no release files", self.output)

    def test_checks_gh_auth_before_upload(self):
        gh = FakeGh(auth_ok=False)
        self.assertEqual(self.publish(gh), 1)
        self.assertIn("gh auth login", self.output)
        self.assertEqual(gh.uploads(), [])


class BuildSelectionTest(unittest.TestCase):
    def test_platform_restrictions(self):
        self.assertIsNotNone(build._skip_reason("mac", "windows"))
        self.assertIsNotNone(build._skip_reason("linux", "windows"))
        self.assertIsNotNone(build._skip_reason("win", "linux"))
        self.assertIsNone(build._skip_reason("mac", "linux"))  # zip-only build
        self.assertIsNone(build._skip_reason("win", "mac"))
        self.assertIsNone(build._skip_reason("linux", "mac"))

    def test_linux_targets_by_arch(self):
        self.assertEqual(build._linux_targets("x86_64")[0], ["AppImage", "deb"])
        with mock.patch.object(build.proc, "which", lambda name: None):
            targets, env, warning = build._linux_targets("arm64")
        self.assertEqual(targets, ["AppImage"])
        self.assertIn("fpm", warning)
        with mock.patch.object(build.proc, "which", lambda name: "/usr/bin/fpm" if name == "fpm" else None):
            targets, env, warning = build._linux_targets("arm64")
        self.assertEqual((targets, env, warning), (["AppImage", "deb"], {"USE_SYSTEM_FPM": "true"}, None))

    def test_nothing_buildable_fails(self):
        out = io.StringIO()
        with mock.patch.object(build, "host_os", lambda: "windows"), \
                contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            self.assertEqual(build.main(Path("."), ["--mac", "--linux"]), 1)


if __name__ == "__main__":
    unittest.main()
