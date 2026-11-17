// What the plugin's own TypeScript builds is judged in Rust: the plugin has no validator in JavaScript. A test that
// builds requests names each and keeps the list, as the JSON that crosses the IPC, in a file of
// tests/fixtures/typescript, and tests/typescript_requests.rs gives every request of those files to the checks that
// the commands run. A request that changes fails the test that keeps it until the files are written again and Rust
// has judged them:
//
//   npm run write:requests && cargo test --test typescript_requests
//
// The comparison is a file snapshot of node:test (`t.assert.fileSnapshot`, from Node 22.14), which writes the file
// instead when node runs with --test-update-snapshots, as that script does.
import { fileURLToPath } from 'node:url';

const folder = new URL('./fixtures/typescript/', import.meta.url);
const written = (cases) => `${JSON.stringify(cases, null, 2)}\n`;

/**
 * Keeps `cases` as the file `name` of tests/fixtures/typescript, in the test `t`. A case is `{ name, command, input }`,
 * which Rust is to take; with `code` Rust is to refuse it with that code. With `after`, the name of a start earlier
 * in the file, Rust takes the request on its own and judges it against that start, as the native layer judges an
 * update or an end.
 */
export function keep(t, name, cases) {
  const file = `tests/fixtures/typescript/${name}.json`;
  try {
    t.assert.fileSnapshot(cases, fileURLToPath(new URL(`${name}.json`, folder)), { serializers: [written] });
  } catch (error) {
    throw new Error(`${file} is not what this test builds. Write it again and let Rust judge it: `
      + 'npm run write:requests && cargo test --test typescript_requests', { cause: error });
  }
}
