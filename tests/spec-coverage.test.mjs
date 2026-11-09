// tools/spec-coverage.sh on small trees of its own: a test counts for a requirement only when it names the ID right
// above its declaration or in its title, and a script is no test.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const tool = fileURLToPath(new URL('../tools/spec-coverage.sh', import.meta.url));
// The IDs of the samples, built so that this file names none of them itself.
const A1 = ['TP', 'A', '1'].join('-');
const A2 = ['TP', 'A', '2'].join('-');
const B9 = ['TP', 'B', '9'].join('-');

/** Runs the tool on a tree of `files` with a spec that defines A1 and A2 and lists `rows` as its tests. */
function check(rows, files) {
  const root = mkdtempSync(join(tmpdir(), 'live-activity-spec-'));
  try {
    const spec = ['# Spec', '', '| ID | Behavior | Input | Errors | Platform |', '| --- | --- | --- | --- | --- |',
      `| ${A1} | One. | — | — | all |`, `| ${A2} | Two. | — | — | all |`, '', '## Tests', '',
      '| Requirement | Tests |', '| --- | --- |', ...Object.entries(rows).map(([id, cell]) => `| ${id} | ${cell} |`), ''];
    for (const [path, text] of Object.entries({ 'docs/spec.md': spec.join('\n'), ...files })) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    mkdirSync(join(root, 'tools'), { recursive: true });
    copyFileSync(tool, join(root, 'tools/spec-coverage.sh'));
    const run = spawnSync('sh', [join(root, 'tools/spec-coverage.sh')], { encoding: 'utf8' });
    return { status: run.status, output: run.stdout + run.stderr };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const node = [
  "import { test } from 'node:test';",
  `// ${A1}`,
  "test('one works', () => {});",
  '',
  `test('${A2}: two works', () => {});`,
  '',
  "test('helper without a requirement', () => {});",
  '',
].join('\n');
const two = `\`tests/a.test.mjs::${A2}: two works\` (node)`;
const fails = (output, text) => assert.ok(output.includes(`FAIL ${text}`), output);

// TP-CI-2
test('a test counts when it names the requirement right above it or in its title', () => {
  const { status, output } = check({ [A1]: '`tests/a.test.mjs::one works` (node)', [A2]: two }, { 'tests/a.test.mjs': node });
  assert.equal(status, 0, output);
  assert.match(output, /requirements: 2; test references: 2 \(node 2\)/);
});

// TP-CI-2
test('a test whose file names the requirement only elsewhere does not count', () => {
  const { status, output } = check({
    [A1]: '`tests/a.test.mjs::helper without a requirement` (node)', [A2]: two,
  }, { 'tests/a.test.mjs': node });
  assert.equal(status, 1, output);
  fails(output, `${A1}: tests/a.test.mjs::helper without a requirement does not name it above its declaration`);
});

// TP-CI-2
test('a script, a missing test or an undefined ID fails the check', () => {
  const script = check({ [A1]: '`tools/spec-coverage.sh::spec-coverage.sh` (build)', [A2]: two }, { 'tests/a.test.mjs': node });
  assert.equal(script.status, 1, script.output);
  fails(script.output, `${A1} has no test in the test table`);
  const missing = check({ [A1]: '`tests/a.test.mjs::one fails` (node)', [A2]: two }, { 'tests/a.test.mjs': node });
  fails(missing.output, `${A1}: tests/a.test.mjs has no test one fails`);
  const extra = `${node}// ${B9}\ntest('three', () => {});\n`;
  const undefinedId = check({ [A1]: '`tests/a.test.mjs::one works` (node)', [A2]: two }, { 'tests/a.test.mjs': extra });
  fails(undefinedId.output, `tests/a.test.mjs name ${B9}, which docs/spec.md does not define`);
});

// TP-CI-2
test('Rust, Kotlin and Swift tests name the requirement above their attributes and annotations', () => {
  const rust = `#[cfg(test)]\nmod tests {\n    // ${A1}\n    #[test]\n    fn one_works() {}\n\n    // ${A1}\n\n    #[test]\n    fn two_works() {}\n}\n`;
  const kotlin = `class ATest {\n    // ${A2}\n    @Test fun twoWorks() {}\n}\n`;
  const swift = `final class Tests: XCTestCase {\n    // ${A1}, ${A2}\n    func testBoth() {}\n}\n`;
  const files = {
    'src/a.rs': rust,
    'android/src/test/java/ATest.kt': kotlin,
    'tests/ios/DemoUITests/UITests/Tests.swift': swift,
  };
  const good = check({
    [A1]: '`src/a.rs::one_works` (unit)<br>`tests/ios/DemoUITests/UITests/Tests.swift::testBoth` (simulator)',
    [A2]: '`android/src/test/java/ATest.kt::twoWorks` (kotlin)',
  }, files);
  assert.equal(good.status, 0, good.output);
  // A blank line parts the comment from the test.
  const parted = check({ [A1]: '`src/a.rs::two_works` (unit)', [A2]: '`android/src/test/java/ATest.kt::twoWorks` (kotlin)' }, files);
  fails(parted.output, `${A1}: src/a.rs::two_works does not name it above its declaration`);
});
