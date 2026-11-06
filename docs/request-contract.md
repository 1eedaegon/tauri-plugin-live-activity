# Request contract

Contract v1 is the request input used since `0.1.0-alpha.1`. 0.2.0 leaves it unchanged
and adds [contract v2](#request-contract-v2-layout) for layouts. Validator tests in other
languages reuse `contracts/request.schema.json` and `tests/fixtures/requests.json`.
`tools/validate-request.mjs` is the reference implementation, for development only.

## Format

The test envelope is `{ "command": "start" | "update" | "end", "input": ... }`. The real
Tauri `start`, `update` and `end` commands take `{ input: ... }`. Unknown fields, `null`
and numbers in strings are rejected. Input is never corrected or converted.

| Value | Rule |
| --- | --- |
| activityKey | 1–128 characters. Starts with an ASCII letter or digit, then ASCII letters, digits, `.`, `_`, `:` and `-`. A key internal to the app; it must not hold secrets |
| id | The opaque handle of 1–256 characters that the plugin returned. Never read as a path or URL |
| schemaVersion | 1 |
| template | `progress` or `timer` |
| fallback | `none` or `notification`; required on start |
| revision | An integer in 0..9007199254740991, not a string |
| title / status | 1–120 / 1–240 Unicode code points; a string of only whitespace is rejected |
| progress | A finite number in 0..1 |
| timer | Both `startedAt` and `endsAt`, with `endsAt` > `startedAt` |
| Times | Integer UTC Unix epoch milliseconds in 0..8640000000000000; no local time strings, no seconds |
| staleAt | An optional time. A past value is allowed: the activity may already be stale |

A start takes `activityKey`, `schemaVersion`, `template`, `fallback` and `snapshot`. The
snapshot holds `revision`, `title`, `status` and exactly one of `progress` or `timer`. The
template of a start must match the shape of its snapshot. An update takes `id` and a
complete snapshot. It is not a patch: omitted fields are not merged from earlier values.
The Rust layer, which knows the native state, rejects a template change on an existing
activity.

An end takes `id` and `policy`. The policy is one of `{ "kind": "immediate" }`,
`{ "kind": "default" }` and `{ "kind": "after", "at": ... }`. Which `after` dates an OS
accepts is checked natively; passing the schema does not mean the OS supports the date.

## Observation and recovery

- Promotion: `promotionRequested: boolean` and
  `promotionState: promoted | notPromoted | unknown | notApplicable` are separate fields.
- Features: `supported`, `unsupported` and `unknown` are distinct. A feature that has not
  been verified is not reported as `supported`.
- Display: a successful native call does not prove that anything was shown.
  `visibility: unknown` is a normal result.
- `fallback: none` means that the plugin does not pick the ordinary notification backend
  instead. It cannot stop Android from leaving a posted notification unpromoted, or the
  user from demoting it. The current API cannot guarantee "promoted or nothing", and the
  docs say so.
- A backend that cannot query the OS does not assume that a local record is active. It
  keeps the request history apart from the last observation. An ended handle is never
  reused.
- An active start with the same key refers to the same activity, and a repeat with
  different content is a conflict. A new start after the activity ended gets a new handle.
  An update with the old handle does not reach the new activity. An end succeeds again
  only for a known ended activity; an unknown handle gets `NOT_FOUND`.

Concurrency, restarts and idempotency are tested in the Rust and native layers, which
hold the state. The development validator checks input only and has no lifecycle; native
tests cover the lifecycle.

## Who checks what

JSON Schema checks shape, length, range and the template match. The reference tool also
checks the order of the timer times. The Rust, Swift and Kotlin fixture tests apply the
same rules. The native code checks the final Swift encoded size of state and attributes,
the real OS capabilities and permissions, ID ownership, and the comparison with the
previous revision. Character limits do not replace the 4 KB check.

```sh
npm ci
npm test
```

The root npm package is the TypeScript API, used together with the Rust crate. Its tests
are unit tests and checks against the shared fixtures. Native integration and end-to-end
tests, and the coverage of each layer, are recorded separately in the
[validation record](validation.md).

## Request contract v2 (layout)

Status: released in 0.2.0. It follows the
[layout DSL RFC](rfc-layout-dsl.md) with the differences listed at the end of this section.
Contract v1 above is unchanged.

In v2 the host sends a tree of nodes, and a widget extension that the host builds from the
plugin's template (`templates/ios`) draws it. The tree is sent once, at start. An update sends
values only.

`contracts/request.schema.json` holds the shapes of both versions. Its envelope
`{ "command", "input" }` takes the v1 and the v2 command names.
`tests/fixtures/layout-requests.json` lists requests with the result every validator must give:
a `valid` start or update states its weight, and an `invalid` case states its error code. Most
cases use `start_layout`, `update_layout` or `end_layout`. A few invalid cases send a body to the
v1 `start` or `update` command, and a runner passes those to its v1 validator. Two use command
names that the envelope does not take: `startLayout`, the JavaScript function name, and
`list_layout`, which takes no input. A runner answers both with `INVALID_INPUT`. An `input` that
is not an object, such as `null`, an array or a string, is `INVALID_INPUT` as well. The verdict,
the error code and the weight are the contract; the issue list of `tools/validate-request.mjs`
only helps to find the broken rule.

The three Tauri commands take `{ input: ... }`; `list_layout` takes no input.

### Commands

| Layer | Names |
| --- | --- |
| Tauri commands | `start_layout`, `update_layout`, `end_layout`, `list_layout` |
| JavaScript | `startLayout`, `updateLayout`, `endLayout`, `listLayout`, `onAction` |
| Rust (`LiveActivity<R>`) | `start_layout`, `update_layout`, `end_layout`, `list_layout`, `on_action` |
| Permissions | `allow-start-layout`, `allow-update-layout`, `allow-end-layout`, `allow-list-layout`, and the matching `deny-` entries |

The default permission set gains `allow-list-layout` only. The commands that change an activity
need an explicit grant, as in v1.

The two versions do not see each other's activities, and the same `activityKey` can be in use in
both. `update` or `end` with the id of a layout activity answers `NOT_FOUND`, and so does
`update_layout` or `end_layout` with a v1 id. `list` returns v1 activities and `list_layout`
returns layout activities.

`getCapabilities` gains `layout`: `supported`, `unsupported` or `unknown`. `actions` is
`supported` on iOS 17 and later and on Android, and `unsupported` elsewhere. On desktop both are
`unsupported`.

A tap on a `button` node reaches the handlers registered with `onAction` and `on_action`. The
event carries `actionId` and `activityId`, and `activityKey` when it is known.

On iOS the button's intent waits until the `on_action` handlers registered at the time of the tap
have run, for at most 4 seconds, so an app that the system launched for the tap keeps running
meanwhile. The system can launch the app in the background for a tap; the app's `setup` may then
never run, and no web view may exist for `onAction`. Register `on_action` handlers on the built
`App` before `App::run`, or in the setup of a plugin, and not in the app's `setup`.

On Android a notification shows the layout in part. The plugin walks the lock screen tree in
document order with the values and conditions applied: the first `text` is the title, the second
the body, the first `progress` and `timerText` drive the progress bar and the chronometer, and up
to three `button`s become notification actions labelled with the first text inside them. Every
other shown node is left out and named once in `degradedFeatures` as `layout.<type>`, followed by
`layout.island`, `layout.styles`, `layout.background` and `layout.keyline` when the request has
them. `android.visibility` sets the lock screen visibility, `private` when absent. A tap reaches
`on_action` through the channel that Rust registers at plugin setup; a tap that started a killed
process waits in memory until the Tauri runtime registers that channel in the same process, and
is lost if it does not. Android reads a minus zero as 0, so a request with `-0.0`, as serde_json
writes an f64 minus zero, and the same request with `0` are one request. The details are in
[Android integration](android-integration.md).

### Requests

```jsonc
// start_layout
{
  "activityKey": "fremen:session",           // same rule as v1
  "schemaVersion": 2,                         // exactly 2
  "fallback": "none",                         // "none" or "notification"; required, as in v1
  "layout": { "lockScreen": { "type": "text", "bind": "title", "style": "title" } },   // required
  "styles": { "title": { "font": "headline" } },                                       // optional; 1 to 24 styles
  "snapshot": { "revision": 0, "values": { "title": "Focus" }, "staleAt": 1790000000000 },
  "android": { "visibility": "private" }      // optional; "public", "private" or "secret"
}

// update_layout
{ "id": "<handle>", "snapshot": { "revision": 1, "values": { "title": "Break" } } }

// end_layout: the same shape as the v1 end
{ "id": "<handle>", "policy": { "kind": "immediate" } }
```

`activityKey`, `id`, `revision`, `staleAt`, `fallback` and `policy` follow the v1 rules. `staleAt`
is optional in both snapshots. `android`, when present, must carry `visibility`; iOS ignores it.

An `id` is 1 to 256 code points and holds at least one character that is not whitespace.
Whitespace here is the ECMAScript set: U+0009 to U+000D, U+0020, U+00A0, U+1680, U+2000 to
U+200A, U+2028, U+2029, U+202F, U+205F, U+3000 and U+FEFF. So a byte order mark (U+FEFF) alone is
not an id, and NEL (U+0085) alone is one. This is the v1 rule: `$defs/id` in the schema, whose
pattern `\S` may match anywhere in the string.

Input is strict, as in v1. An unknown member, `null`, a value of the wrong type or a value out of
range is `INVALID_INPUT`. Nothing is corrected or converted, and an optional member is left out,
not set to `null`. Ranges include both ends. Each pattern given in this section must match the
whole string. Names are case-sensitive. Error messages are constant text and never repeat input.

The rules apply to JSON as `JSON.stringify` writes it: no object repeats a member, and a number
has its shortest form, so an integer has no fraction, exponent or minus zero (`1`, not `1.0`,
`1e0` or `-0`). Other text is outside the contract, and the layers may read it differently:
JavaScript and Swift accept `1.0` where an integer is required and Rust does not; Swift keeps the
first of two equal members and JavaScript and Rust the last; Swift refuses a number that
underflows, such as `1e-400`, which the others read as 0. The shared fixtures hold only the
contract's form.

Requests sent through the JavaScript or the Rust API do not always reach the native layer in this
form. Rust reads every request into its own types and sends what serde_json writes for them, and
serde_json writes an f64 with a fraction when it is whole and keeps a minus zero: a value of `5`
arrives as `5.0`, and so does a `spacing` of 5. A minus zero, which only the Rust API can send,
arrives as `-0.0`. Swift and Android read `5.0` as 5. Android reads `-0.0` as 0; Swift keeps the
minus zero.

Strings hold Unicode scalar values only. JSON can carry a lone UTF-16 surrogate as an escape such
as `\ud800`; a v2 request with one in any string is `INVALID_INPUT`. The JSON parsers of Rust and
Swift refuse such text before a validator runs, so the shared fixture file cannot hold this case:
the Rust and Swift tests would fail to read the whole file.

`start_layout`, `update_layout` and `end_layout` return this record, and `list_layout` returns a
list of them:

```jsonc
{ "id", "activityKey", "schemaVersion": 2, "snapshot": { "revision", "values", "staleAt"? },
  "backend", "state", "visibility": "unknown", "degradedFeatures": [...],
  "promotionRequested", "promotionState" }
```

The record has no `template` and does not repeat the layout.

### Values

`values` is an object with 0 to 32 entries.

- Key: `^[A-Za-z][A-Za-z0-9_]{0,31}$`.
- Value: a string of 0 to 1000 Unicode code points, a finite number from -8640000000000000 to
  8640000000000000, or a boolean. The empty string is allowed. `null`, arrays and objects are
  not.

Text is used as sent. Strings are not normalized: where the NFC and NFD forms of a text differ, as
they do for Korean syllables, they are different strings with different lengths and weights.

A value is truthy when it is `true`, a number other than 0, or a non-empty string. `if` and
`unless` use this.

An update replaces the whole map. It must have exactly the keys accepted at start, and each key
must keep its JSON type (string, number or boolean); otherwise the update is `INVALID_INPUT`.
The native layer checks this, because it holds the started activity.

### Layout

```jsonc
"layout": {
  "lockScreen": Node,              // required
  "island": {                      // optional; at least one member
    "expanded": {                  // optional; at least one region
      "leading": Node, "trailing": Node, "center": Node, "bottom": Node
    },
    "compactLeading": Node,
    "compactTrailing": Node,
    "minimal": Node
  },
  "background": Color,             // optional; tint of the activity background
  "keyline": Color                 // optional; tint of the Dynamic Island keyline
}
```

An island part that the layout leaves out is drawn with a default:

- `expanded`: the lock screen tree, in the bottom region;
- `compactLeading` and `minimal`: the first `symbol` node of the lock screen tree in document
  order, conditions ignored, or the SF Symbol `circle.fill` when the tree has no symbol;
- `compactTrailing`: nothing.

### Nodes

Every node is an object with a `type`. Any node may also carry:

- `style`: a style token;
- `if` or `unless`, not both: a value key. With `if` the node and its subtree are drawn only when
  the value is truthy, with `unless` only when it is not.

In the table, `?` marks an optional member and a value key is a key of `snapshot.values`.

| `type` | Members |
| --- | --- |
| `vstack` | `children`: 1 to 12 nodes; `spacing`?: number 0 to 64; `alignment`?: `leading` `center` `trailing` |
| `hstack` | `children`: 1 to 12 nodes; `spacing`?: number 0 to 64; `alignment`?: `top` `center` `bottom` `firstTextBaseline` |
| `zstack` | `children`: 1 to 12 nodes; `alignment`?: `center` `leading` `trailing` `top` `bottom` `topLeading` `topTrailing` `bottomLeading` `bottomTrailing` |
| `spacer` | `minLength`?: number 0 to 256 |
| `divider` | none |
| `text` | exactly one of `value`: string of 0 to 200 code points, or `bind`: value key (any type) |
| `symbol` | `name`: SF Symbol name, `^[a-z0-9]+(\.[a-z0-9]+)*$`, at most 64 characters; `rendering`?: `monochrome` `hierarchical` `palette` `multicolor`; `variableBind`?: value key (a number from 0 to 1, the variable value of the symbol) |
| `image` | `source`: `{ "asset": "<name>" }`, an image in the asset catalog of the widget extension, name `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`; `resizable`?: boolean; `contentMode`?: `fit` `fill` |
| `path` | `d`: path data, see below; `box`: `[width, height]`, the coordinate space of `d`, each a number 1 to 1024; `stroke`?: number 0.5 to 16, the line width; without it the path is filled |
| `progress` | `bind`: value key (number, shown clamped to 0..1); `kind`?: `linear` `circular` |
| `gauge` | `bind`: value key (number); `min`?, `max`?: numbers, 0 and 1 when left out; `min` must be below `max`, and the check uses the default of a member that is left out; `kind`?: `linear` `circular` |
| `timerText` | `start`, `end`: value keys (times as in v1: integers from 0 to 8640000000000000, in epoch milliseconds; the `end` value after the `start` value); `countsDown`?: boolean, true when left out |
| `button` | `actionId`: `^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$`; `child`: Node |

`d` is SVG path data within these limits:

- 1 to 512 bytes;
- at least one command, so whitespace alone is not path data;
- commands `M L H V C S Q T Z` in upper or lower case, and no arcs (`A`, `a`). The first command
  is `M` or `m`;
- a command is followed by its numbers: 2 for `M`, `L` and `T`, 1 for `H` and `V`, 6 for `C`,
  4 for `S` and `Q`, none for `Z`. The group may repeat, so the count is that size or a multiple
  of it;
- a number is an optional sign, then digits, a fraction or both, then an optional exponent:
  `12`, `-1.5`, `.5`, `1e-3`. A dot is followed by at least one digit;
- two numbers are separated by whitespace, by one comma with optional whitespace around it, or by
  nothing when the second starts with a sign or a dot (`10-5`, `.5.5`). A comma is not allowed
  anywhere else;
- whitespace is space, tab, line feed or carriage return. It is also allowed before and after a
  command and at both ends of `d`.

This grammar departs from SVG on purpose, so every layer implements it as written here and not
through an SVG parser: SVG 1.1 accepts a number that ends in a dot (`1.`), SVG 2 counts a form
feed as whitespace, and both accept path data without a command.

### Structural limits

- Depth: at most 8. The root node of a region has depth 1, and a node in `children` or the
  `child` of a button is one level deeper than its parent.
- Nodes per region, containers included: `lockScreen` 40, each expanded region 12,
  `compactLeading` 3, `compactTrailing` 3, `minimal` 3.
- Buttons: only in `lockScreen` and the expanded regions, never inside another button at any
  depth, and at most 4 per region.

### Reference rules

These rules need the layout, the styles and the values together, so they are checked at start:

- every `bind`, `if`, `unless`, `variableBind`, `start` and `end` names a key of
  `snapshot.values`;
- `progress.bind`, `gauge.bind`, `variableBind`, `timerText.start` and `timerText.end` name a
  number;
- the number that `variableBind` names is from 0 to 1;
- the numbers that `timerText.start` and `timerText.end` name are integers from 0 to
  8640000000000000, and the `end` value is greater than the `start` value;
- every `style` names a token of `styles`. A `style` in a request without `styles` is invalid.

A style that no node uses and a value that no node reads are allowed. The number that a
`progress` or a `gauge` reads is not range-checked; a progress bar shows it clamped to 0..1.

On update the native layer checks the rules that depend on values again, ranges included, against
the layout it stored at start.

### Styles

`styles` maps a token to a style. Token: `^[A-Za-z][A-Za-z0-9_]{0,31}$`. A style is an object
with at least one of these members:

| Member | Value |
| --- | --- |
| `font` | `largeTitle` `title` `title2` `title3` `headline` `subheadline` `body` `callout` `footnote` `caption` `caption2`; not together with `size` |
| `size` | number 6 to 96, in points |
| `weight` | `ultraLight` `thin` `light` `regular` `medium` `semibold` `bold` `heavy` `black` |
| `design` | `default` `rounded` `serif` `monospaced` |
| `monospacedDigit` | boolean |
| `color` | Color, the foreground |
| `lineLimit` | integer 1 to 10 |
| `minimumScaleFactor` | number 0.1 to 1 |
| `alignment` | `leading` `center` `trailing`, for text of several lines |
| `padding` | number 0 to 64, or `[top, leading, bottom, trailing]`, four numbers 0 to 64 |
| `frame` | object with at least one of `width`, `height`, `minWidth`, `minHeight` (numbers 0 to 1024), `maxWidth`, `maxHeight` (number 0 to 1024 or `"infinity"`), `alignment` (the nine `zstack` values) |
| `background` | Color |
| `cornerRadius` | number 0 to 64 |
| `opacity` | number 0 to 1 |
| `tint` | Color, for buttons, progress and gauges |
| `buttonStyle` | `automatic` `bordered` `borderedProminent` `plain` |

The members of a `frame` are checked one by one: a minimum above a maximum is accepted.

A Color is one of:

- a name: `primary` `secondary` `accent` `red` `orange` `yellow` `green` `mint` `teal` `cyan`
  `blue` `indigo` `purple` `pink` `brown` `white` `black` `gray` `clear`;
- a hex string, `#RRGGBB` or `#RRGGBBAA`, with digits in either case. It is used in light and in
  dark mode alike;
- `{ "light": hex, "dark": hex }`, with both members.

A style is applied to its node in this order: font and text members, `color`, `tint` and
`buttonStyle`, `padding`, `frame`, `background`, `cornerRadius`, `opacity`.

### Payload weight

ActivityKit limits the attributes and the content state of an activity to 4 KiB together. As in
v1, the native layer checks that the encoded payload is at most 4096 bytes and fails with
`PAYLOAD_TOO_LARGE` otherwise. Before that check, every layer applies one estimate that does not
depend on an encoding, so that all layers agree to the byte:

```text
weight(string)  = UTF-8 byte length + 2
weight(number)  = 8
weight(boolean) = 5
weight(array)   = 2 + sum over the elements of (weight(element) + 1)
weight(object)  = 2 + sum over the members of (UTF-8 byte length of key + 3 + weight(value) + 1)
```

At start, `weight(layout) + weight(styles) + weight(snapshot.values)` must be at most 3584. A
request without `styles` counts `weight({})`, which is 2. On update the native layer checks the
same sum with the stored layout and styles and the new values, and `weight(values)` alone must be
at most 3584 in every layer. A request over the limit fails with `PAYLOAD_TOO_LARGE`. The
fixtures state this sum for a start and `weight(values)` for an update.

The byte length is that of the text as sent, without escapes. The weight is checked last: a
request that also breaks another rule fails with `INVALID_INPUT`.

The weight is an estimate and does not bound the encoded size, so a request within 3584 can still
fail the native check on iOS. The iOS encoder writes `"`, `\`, `/` and the control characters
with a short escape (`\b \f \n \r \t`) in 2 bytes each, the other characters from U+0000 to
U+001F in 6 bytes (`\u0001`), and a number in up to 24 bytes (`-1.2345678901234568e-300`); the
attributes add a few hundred bytes of their own (the handle, the key, the fingerprint and the
member names). With the layout `{ "lockScreen": { "type": "divider" } }`, one value of 700
U+0001 characters weighs 747 and is `PAYLOAD_TOO_LARGE` on iOS, and so are three values of 1000
`/` (weight 3063), while three values of 1000 letters, also 3063, start. Text full of quotes,
slashes, line breaks or paths therefore fails well below the limit. The estimate can also exceed
the encoded size: a request over 3584 fails in every layer even when it would encode to fewer
than 4096 bytes.

Example: the layout `{ "lockScreen": { "type": "text", "value": "Hello" } }` with no styles and
no values.

```text
node   = 2 + (4 + 3 + 6 + 1) + (5 + 3 + 7 + 1) = 32    "type": "text" and "value": "Hello"
layout = 2 + (10 + 3 + 32 + 1)                 = 48    "lockScreen": node
total  = 48 + 2 + 2                            = 52    layout, {} for styles, {} for values
```

### What the schema covers

The JSON Schema checks shapes, ranges and patterns, including the characters allowed in `d`. It
leaves the grammar of `d`, `min` below `max`, lone surrogates, the structural limits, the
reference rules and the weight to `tools/validate-request.mjs`, which checks those as well and
gives the results the fixtures record. The tool checks a request against the definitions of its
own contract version only, so a v1 request gets the same issues as before v2.

### Differences from the RFC draft

- A start carries `snapshot` with the revision, as in v1, instead of top-level `values` and
  `staleAt`.
- The layout is fixed at start: `update_layout` takes no `layout`.
- Not part of 2.0: `layoutRef`, `image.source.appGroup`, gradients, borders, custom fonts and
  `contentTransition`.
- Member names: `timerText` takes the value keys `start` and `end` instead of `startedAt` and
  `endsAt`, `symbol` takes `variableBind` instead of `variableValue`, and `layout.background` and
  `layout.keyline` replace `activityBackgroundTint` and `keylineTint`. `rendering` and `design`
  spell out `monochrome` and `monospaced` where the draft wrote `mono`.
- A `symbol` has no `weight`, a `progress` has no `tint` (tint is a style member) and a style has
  no `truncation`. A `path` takes a `box` and an optional `stroke` width, and is filled without
  `stroke`.
