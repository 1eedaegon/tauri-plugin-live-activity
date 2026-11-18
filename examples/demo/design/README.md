# Mochi frontend checks

The [design contract](contract.md) defines the screen and its states. The
[browser report](browser-report.json) records automated checks and rendered
previews at 390×844, 1440×900, and a supplemental 320px width. These screenshots
use an injected IPC adapter; they are not evidence of a visible native activity.
Pictures of the app itself, on a simulator and an emulator, are in the
[demo's README](../README.md).

Run the pure scenario and lifecycle tests with `npm run test:demo` from the
repository root. The command enforces 80% line, branch, and function coverage.
The lifecycle source filename contains `test`, so the coverage command explicitly
excludes the test directory instead of using Node's default exclusion rules.

For browser checks, install the optional tools outside the checkout:

```sh
qa_dir=$(mktemp -d)
npm install --prefix "$qa_dir" --ignore-scripts --no-audit --no-fund \
  playwright@1.64.1 @axe-core/playwright@4.14.0
node "$qa_dir/node_modules/playwright/cli.js" install chromium
npm run build:demo
PLAYWRIGHT_MODULE="$qa_dir/node_modules/playwright/index.mjs" \
AXE_MODULE="$qa_dir/node_modules/@axe-core/playwright/dist/index.mjs" \
  node --experimental-strip-types examples/demo/tests/browser-qa.ts
```

The runner serves only the four built frontend files on loopback, exercises the
snack and nap flows and one layout example, checks keyboard focus, permissions,
unknown OS state, long error text, responsive widths, and the opt-in lifecycle
test, whose 30 checks pass on the adapter. Axe checks WCAG A/AA rules on
representative views. It writes local PNG previews and `browser-report.json`
here. It does not prompt for native permissions or contact an external
screenshot service. No workflow runs it: run it after a change to the page.

Review the images after running the checks. Automated assertions cannot judge
whether the illustration, spacing, or copy feel right. The same page is checked
inside the app by the UI tests on an iOS Simulator (`tests/ios/run.sh`).

Reference patterns: [native toggle button state](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-pressed)
and [reduced motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-reduced-motion).
