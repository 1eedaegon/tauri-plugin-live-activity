#!/bin/sh
# Checks that docs/spec.md and the tests agree. It fails when
#   - a requirement has no row in the spec's test table, or the row names no test;
#   - a test in the table does not exist (file and test), or does not name the requirement right above its declaration:
#     in the comment lines directly above it, with attributes and annotations between, or in its own line (a node:test
#     title, a Kotlin `@Test fun` with its comment above);
#   - a requirement is named by no test file, or a test file names an ID the spec does not define.
# A test is `file::name` (level): a Rust `fn`, a Kotlin `fun`, a Swift `func` or the title of a node:test `test(...)`.
# A script is no test. Test files: tests/, src/**/tests.rs and src/**/*_tests.rs, the `mod tests` part of other Rust
# sources, android/src/test, examples/demo/tests and the demo's Rust tests. tests/spec-coverage.test.mjs tests this.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
exec python3 -I - "$root" <<'PYTHON'
import pathlib, re, sys
from collections import Counter

root = pathlib.Path(sys.argv[1])
ID = re.compile(r"\bTP-[A-Z0-9]+-[0-9]+\b")
spec = (root / "docs/spec.md").read_text()
head, _, table = spec.partition("\n## Tests\n")
if not table:
    sys.exit("docs/spec.md has no '## Tests' section")

defined = []
for line in head.splitlines():
    match = re.match(r"^\| (TP-[A-Z0-9]+-[0-9]+) \|", line)
    if match:
        defined.append(match.group(1))
problems = [f"{name} is defined twice" for name, count in Counter(defined).items() if count > 1]
defined_set = set(defined)

def test_text(path):
    text = path.read_text(errors="replace")
    if path.suffix == ".rs" and not (path.name == "tests.rs" or path.name.endswith("_tests.rs")) and "/tests/" not in path.as_posix():
        marker = re.search(r"#\[cfg\(test\)\]\n(pub(\(crate\))? )?mod tests", text)
        return text[marker.start():] if marker else ""
    return text

files = {}
roots = ["tests", "src", "android/src/test", "android/src/androidTest", "examples/demo/tests", "examples/demo/src-tauri/src"]
for folder in roots:
    for path in sorted((root / folder).rglob("*")):
        relative = path.relative_to(root).as_posix()
        if not path.is_file() or path.suffix not in {".rs", ".mjs", ".kt", ".swift"}:
            continue
        if any(part in {"target", "node_modules", "build", "output"} for part in path.parts):
            continue
        files[relative] = test_text(path)

named = {}
for relative, text in files.items():
    for name in ID.findall(text):
        named.setdefault(name, set()).add(relative)

# What may stand between a test's comment and its declaration, or hold the comment itself.
PREAMBLE = re.compile(r"^\s*(//|#\[|@)")

def declaration(relative, name, text):
    """The declaration of test `name` with the comment, attribute and annotation lines directly above it, or None."""
    suffix = pathlib.PurePosixPath(relative).suffix
    if suffix == ".mjs":
        found = lambda line: any(f"test({quote}{name}{quote}" in line for quote in "'\"`")
    else:
        keyword = {".rs": "fn", ".kt": "fun", ".swift": "func"}[suffix]
        pattern = re.compile(rf"\b{keyword}\s+{re.escape(name)}\b")
        found = lambda line: pattern.search(line) is not None
    lines = text.split("\n")
    for index, line in enumerate(lines):
        if found(line):
            start = index
            while start > 0 and PREAMBLE.match(lines[start - 1]):
                start -= 1
            return "\n".join(lines[start:index + 1])
    return None

traced = {}
for line in table.splitlines():
    match = re.match(r"^\| (TP-[A-Z0-9]+-[0-9]+) \| (.*) \|\s*$", line)
    if not match:
        continue
    requirement, cell = match.groups()
    if requirement in traced:
        problems.append(f"{requirement} has two rows in the test table")
    tests = re.findall(r"`([^`:]+)::([^`]+)` \((unit|node|kotlin|simulator)\)", cell)
    traced[requirement] = tests
    if requirement not in defined_set:
        problems.append(f"the test table names {requirement}, which the spec does not define")
    for relative, name, _level in tests:
        text = files.get(relative)
        if text is None:
            problems.append(f"{requirement}: {relative} is not a test file")
            continue
        declared = declaration(relative, name, text)
        if declared is None:
            problems.append(f"{requirement}: {relative} has no test {name}")
        elif requirement not in ID.findall(declared):
            problems.append(f"{requirement}: {relative}::{name} does not name it above its declaration")

for requirement in defined:
    if not traced.get(requirement):
        problems.append(f"{requirement} has no test in the test table")
    if requirement not in named:
        problems.append(f"{requirement} is named by no test file")
for name, where in sorted(named.items()):
    if name not in defined_set:
        problems.append(f"{', '.join(sorted(where))} name {name}, which docs/spec.md does not define")

areas = Counter(name.split("-")[1] for name in defined)
levels = Counter(level for tests in traced.values() for _, _, level in tests)
print("requirements by area: " + ", ".join(f"{area} {count}" for area, count in sorted(areas.items())))
print(f"requirements: {len(defined)}; test references: {sum(levels.values())} "
      f"({', '.join(f'{level} {count}' for level, count in sorted(levels.items()))})")
if problems:
    print("\n".join("FAIL " + problem for problem in problems))
    sys.exit(f"spec coverage: {len(problems)} problem(s)")
print("spec coverage: every requirement has a test, and every test names a requirement of the spec")
PYTHON
