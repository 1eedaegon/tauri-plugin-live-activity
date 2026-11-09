# Request contract

Contract v1 is the request input used since `0.1.0-alpha.1`. 0.2.0 leaves it unchanged
and adds [contract v2](#request-contract-v2-layout) for layouts. Validator tests in other
languages reuse `contracts/request.schema.json` and `tests/fixtures/requests.json`.
`tools/validate-request.mjs` is the reference implementation, for development only. Since 0.4
the schema file is a copy of the activitykit crate's, which also holds contract v2.

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
checks the order of the timer times. The Rust fixture tests apply the same rules.
On iOS the plugin's Rust checks a v1 request, turns it into a layout activity
([below](#the-templates-on-ios)) and checks that as a v2 request; activitykit's Swift layer
then checks the final encoded size of state and attributes and reports the real OS
capabilities and permissions. The plugin's Rust and activitykit find the activity by its id and
compare with the previous revision. On Android the plugin's Rust checks a v1 request and the
[liveupdate](https://github.com/1eedaegon/liveupdate-rs) crate checks it again, keeps its
revisions and receipts and finds the activity by its id; the Kotlin side only posts, observes
and cancels the notification and stores the receipts. Character limits do not replace the 4 KB
check.

```sh
npm ci
npm test
```

The root npm package is the TypeScript API, used together with the Rust crate. Its tests
are unit tests and checks against the shared fixtures. Native integration and end-to-end
tests, and the coverage of each layer, are recorded separately in the
[validation record](validation.md).

## Request contract v2 (layout)

Status: released in 0.2.0. [Bound style members](#bound-style-members), the style member
`fontFamily`, images from a `file`, [custom nodes](#custom-nodes) and
[`write_image`](#images-the-app-writes) came in 0.3.0. In 0.4 v2 is the contract of the
[activitykit](https://github.com/1eedaegon/activitykit-rs) crate, which adds a `timestamp` to snapshots,
final content to `end_layout`, the state `pending` and the error code `NOT_FOREGROUND`. It follows the
[layout DSL RFC](rfc-layout-dsl.md) with the differences listed at the end of this section. Contract v1
above is unchanged.

In v2 the host sends a tree of nodes. On iOS activitykit's widget, `ActivityKitLayoutWidget`, draws
it in a widget extension of the app. The tree is sent once, at start. An update sends values only.
A bound style member reads a value, so an update can change a color, a size or an opacity; the tree
and every other member stay as they started.

In this section the native layer is activitykit's Swift layer on iOS and the plugin's Kotlin on
Android. The plugin's Rust validator is activitykit's: the plugin converts each request into
activitykit's types and checks it there.

`contracts/request.schema.json` holds the shapes of both versions. Its envelope
`{ "command", "input" }` takes the v1 and the v2 command names.
`tests/fixtures/layout-requests.json` lists requests with the result every validator must give:
a `valid` start, update or end with final content states its weight, and an `invalid` case states
its error code. A third list, `updates`, holds a `start` and the `update` after it, which a runner
checks the way the native layer checks an update against the activity it started; a valid pair
states the weight of the layout, the styles and the new values, and an invalid one its error code.
A fourth list, `ends`, holds a `start` and an `end_layout` with final content, checked the same way.
Both files are activitykit's, byte for byte, at the version that the plugin's `Cargo.lock` holds:
`node tools/sync-contract.mjs --write` copies them after activitykit changed, and
`tests/contract-sync.test.mjs` fails when they differ. Change the contract in activitykit, not
here. Most cases use
`start_layout`, `update_layout` or `end_layout`. A few invalid cases send a body to the
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
| Tauri commands | `start_layout`, `update_layout`, `end_layout`, `list_layout`, `write_image` |
| JavaScript | `startLayout`, `updateLayout`, `endLayout`, `listLayout`, `onAction`, `writeImage` |
| Rust (`LiveActivity<R>`) | `start_layout`, `update_layout`, `end_layout`, `list_layout`, `on_action`, `write_image` |
| Permissions | `allow-start-layout`, `allow-update-layout`, `allow-end-layout`, `allow-list-layout`, `allow-write-image`, and the matching `deny-` entries |

The default permission set gains `allow-list-layout` only. The commands that change an activity
need an explicit grant, as in v1.

The two versions do not see each other's activities. `update` or `end` with the id of a layout
activity answers `NOT_FOUND`, and so does `update_layout` or `end_layout` with a v1 id. `list`
returns v1 activities and `list_layout` returns layout activities. On Android the same
`activityKey` can be in use in both; on iOS it cannot, see below.

`getCapabilities` gains `layout`: `supported`, `unsupported` or `unknown`. `actions` is
`supported` on iOS 17 and later and on Android, and `unsupported` elsewhere. On desktop both are
`unsupported`.

A tap on a `button` node reaches the handlers registered with `onAction` and `on_action`. The
event carries `actionId` and `activityId`, and `activityKey` when it is known.

On iOS the tap comes from activitykit's events. The button's intent returns once the plugin has
taken the tap, at most 4 seconds after it, before the `on_action` handlers have run. On Android the
native side waits for the handlers, for at most 4 seconds. The system can launch the app in the
background for a tap; the app's `setup` may then never run, and no web view may exist for
`onAction`. Register `on_action` handlers on the built `App` before `App::run`, or in the setup of
a plugin, and not in the app's `setup`.

On Android a notification shows the layout in part. The plugin walks the lock screen tree in
document order with the values and conditions applied: the first `text` is the title, the second
the body, the first `progress` and `timerText` drive the progress bar and the chronometer, and up
to three `button`s become notification actions labelled with the first text inside them. Every
other shown node is left out and named once in `degradedFeatures` as `layout.<type>` (a custom node
as `layout.custom`), followed by `layout.island`, `layout.styles`, `layout.background` and
`layout.keyline` when the request has them. The first shown `image` whose source is a `file` is the
notification's large icon and is not listed. `android.visibility` sets the lock screen visibility, `private` when absent. A tap reaches
`on_action` through the channel that Rust registers at plugin setup; a tap that started a killed
process waits in memory until the Tauri runtime registers that channel in the same process, and
is lost if it does not. Android reads a minus zero as 0, so a request with `-0.0`, as serde_json
writes an f64 minus zero, and the same request with `0` are one request. The details are in
[Android integration](android-integration.md).

### The templates on iOS

activitykit has no templates. On iOS `start` turns a v1 request into a layout activity with a fixed
tree: title, status and a progress bar or a timer on the Lock Screen and in the Dynamic Island. The
snapshot's fields become its values (`title`, `status`, `progress` with `percent`, or `startedAt` and
`endsAt`), with the marker value `liveActivityTemplate` set to `progress` or `timer`, by which `list`
and the v1 commands find their activities and the layout commands leave them alone. The records stay
v1 records. Both versions start through activitykit's keys, so a template and a layout activity
cannot run under the same `activityKey`: the second start answers `CONFLICT`. The key
`liveActivityTemplate` is therefore the plugin's: a layout start, update or end whose values hold it
answers `INVALID_INPUT` on every platform, although activitykit's contract allows it.

### Requests

```jsonc
// start_layout
{
  "activityKey": "app:session",           // same rule as v1
  "schemaVersion": 2,                         // exactly 2
  "fallback": "none",                         // "none" or "notification"; required, as in v1
  "layout": { "lockScreen": { "type": "text", "bind": "title", "style": "title" } },   // required
  "styles": { "title": { "font": "headline" } },                                       // optional; 1 to 24 styles
  "snapshot": { "revision": 0, "values": { "title": "Focus" }, "staleAt": 1790000000000, "timestamp": 1789999400000 },
  "android": { "visibility": "private" }      // optional; "public", "private" or "secret"
}

// update_layout
{ "id": "<handle>", "snapshot": { "revision": 1, "values": { "title": "Break" }, "timestamp": 1789999700000 } }

// end_layout: the v1 end with an optional "snapshot", the final content
{ "id": "<handle>", "policy": { "kind": "immediate" }, "snapshot": { "revision": 2, "values": { "title": "Done" } } }
```

`activityKey`, `id`, `revision`, `staleAt`, `fallback` and `policy` follow the v1 rules. `staleAt`
and `timestamp` are optional in every snapshot. `android`, when present, must carry `visibility`;
iOS ignores it.

`timestamp` is a time by the v1 rule: when the snapshot's content was made. ActivityKit uses it
from iOS 17.2 to drop content older than what it shows; such a request still succeeds. Without one,
iOS takes the time the content is sent, and a start's content is always timed when it is sent.
Android keeps the timestamp in the record; the iOS record leaves it out.

The `snapshot` of an end is the final content, checked like an update: the keys and value types of
the start, `STALE_REVISION` below the accepted revision and `CONFLICT` at it with other values.
Without it the activity ends with its last accepted content. On iOS the `after` policy takes any
time: the system removes the ended activity at that time or four hours after the end, whichever
comes first, and a time in the past removes it at once. Android answers `after` with
`UNSUPPORTED_FEATURE` and removes the notification on every end; the final content is in the
record.

Revisions go out as sent, on iOS as on Android. An update or the final content of an end below the
accepted revision is `STALE_REVISION`; at the accepted revision it answers the record when the
values are the same and is `CONFLICT` otherwise; above it, it is taken. On iOS an end without final
content goes out at the next revision with the last values. The same start under a running key
answers the running activity, also after a relaunch: activitykit compares the content without its
timestamp.

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
{ "id", "activityKey", "schemaVersion": 2, "snapshot": { "revision", "values", "staleAt"?, "timestamp"? },
  "backend", "state", "visibility": "unknown", "degradedFeatures": [...],
  "promotionRequested", "promotionState" }
```

The record has no `template` and does not repeat the layout. `state` is `pending`, `active`,
`stale`, `ended`, `dismissed` or `unknown`; `pending` is iOS 26's state of a scheduled start, which
the plugin does not make.

### Errors

A failed request answers `{ "code", "message" }`; the message never repeats the request. The codes are
`INVALID_INPUT`, `PAYLOAD_TOO_LARGE`, `NOT_FOUND`, `CONFLICT`, `STALE_REVISION`,
`PERMISSION_DENIED`, `NOT_FOREGROUND`, `CONFIGURATION_REQUIRED`, `UNSUPPORTED_PLATFORM`,
`UNSUPPORTED_FEATURE`, `SYSTEM_LIMIT` and `NATIVE_ERROR`. `NOT_FOREGROUND` is new in 0.4: ActivityKit
refused a start because the app was not in the foreground (0.3 answered `NATIVE_ERROR` or
`PERMISSION_DENIED`). On iOS the codes are activitykit's, and the message of `UNSUPPORTED_FEATURE`
names the feature and the iOS version it needs, that of `SYSTEM_LIMIT` whether the app's or the
device's limit was reached.

### Values

`values` is an object with 0 to 32 entries.

- Key: `^[A-Za-z][A-Za-z0-9_]{0,31}$`, except `liveActivityTemplate`, which the plugin keeps for
  its templates on iOS.
- Value: a string of 0 to 1000 Unicode code points, a finite number from -8640000000000000 to
  8640000000000000, or a boolean. The empty string is allowed. `null`, arrays and objects are
  not.

Text is used as sent. Strings are not normalized: where the NFC and NFD forms of a text differ, as
they do for Korean syllables, they are different strings with different lengths and weights.

A value is truthy when it is `true`, a number other than 0, or a non-empty string. `if` and
`unless` use this.

An update replaces the whole map, and so does the final content of an end. It must have exactly
the keys accepted at start, and each key must keep its JSON type (string, number or boolean);
otherwise the request is `INVALID_INPUT`. The native layer checks this, because it holds the
started activity.

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
  "background": Color | Binding,   // optional; tint of the activity background
  "keyline": Color | Binding       // optional; tint of the Dynamic Island keyline
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
| `image` | `source`: exactly one of `{ "asset": "<name>" }`, an image in the asset catalog of the widget extension, and `{ "file": "<name>" }`, a PNG that the app wrote with [`write_image`](#images-the-app-writes); a name is `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`; `resizable`?: boolean; `contentMode`?: `fit` `fill` |
| `path` | `d`: path data, see below; `box`: `[width, height]`, the coordinate space of `d`, each a number 1 to 1024; `stroke`?: number 0.5 to 16, the line width; without it the path is filled |
| `progress` | `bind`: value key (number, shown clamped to 0..1); `kind`?: `linear` `circular` |
| `gauge` | `bind`: value key (number); `min`?, `max`?: numbers, 0 and 1 when left out; `min` must be below `max`, and the check uses the default of a member that is left out; `kind`?: `linear` `circular` |
| `timerText` | `start`, `end`: value keys (times as in v1: integers from 0 to 8640000000000000, in epoch milliseconds; the `end` value after the `start` value); `countsDown`?: boolean, true when left out |
| `button` | `actionId`: `^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$`; `child`: Node |
| `custom` | `name`: `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`, a view the app registers; `props`?: 1 to 16 entries, see [Custom nodes](#custom-nodes) |

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
- every `style` names a token of `styles`. A `style` in a request without `styles` is invalid;
- every [bound member](#bound-style-members), in every style whether a node uses it or not, names
  a key of `snapshot.values` whose value the member takes;
- every binding among the `props` of a `custom` node names a key of `snapshot.values`, of any type.

A style that no node uses and a value that no node reads are allowed. The number that a
`progress` or a `gauge` reads is not range-checked; a progress bar shows it clamped to 0..1.

On update, and for the final content of an end, the native layer checks the rules that depend on
values again, ranges and bound members included, against the layout and styles it stored at start.
Rust and the reference tool check an update or an end alone, since they keep no layout;
`LayoutStartInput::validate_update` and `validate_end` in Rust and `validateLayoutUpdate` and
`validateLayoutEnd` in `tools/validate-request.mjs` apply the native check to a start and the
request after it that the caller passes, and run the `updates` and `ends` fixtures.

### Styles

`styles` maps a token to a style. Token: `^[A-Za-z][A-Za-z0-9_]{0,31}$`. A style is an object
with at least one of these members:

| Member | Value |
| --- | --- |
| `font` | `largeTitle` `title` `title2` `title3` `headline` `subheadline` `body` `callout` `footnote` `caption` `caption2`; not together with `size` |
| `size` | number 6 to 96, in points; or a binding |
| `weight` | `ultraLight` `thin` `light` `regular` `medium` `semibold` `bold` `heavy` `black`; or a binding |
| `design` | `default` `rounded` `serif` `monospaced`; not together with `fontFamily` |
| `fontFamily` | the PostScript or family name of a font that the widget extension bundles, `^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$` (a space is allowed after the first character); not together with `design` |
| `monospacedDigit` | boolean |
| `color` | Color, the foreground; or a binding |
| `lineLimit` | integer 1 to 10 |
| `minimumScaleFactor` | number 0.1 to 1 |
| `alignment` | `leading` `center` `trailing`, for text of several lines |
| `padding` | number 0 to 64, or `[top, leading, bottom, trailing]`, four numbers 0 to 64 |
| `frame` | object with at least one of `width`, `height`, `minWidth`, `minHeight` (numbers 0 to 1024), `maxWidth`, `maxHeight` (number 0 to 1024 or `"infinity"`), `alignment` (the nine `zstack` values) |
| `background` | Color; or a binding |
| `cornerRadius` | number 0 to 64; or a binding |
| `opacity` | number 0 to 1; or a binding |
| `tint` | Color, for buttons, progress and gauges; or a binding |
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

With `fontFamily`, iOS draws the text in that font: with `font` at the text style's size at the
default text size (`title3` is 20 points), scaled with Dynamic Type; with `size` at that size; alone at
17 points, scaled like `body`. A name the extension lacks draws the system font at that size, and
nothing reports it. `fontFamily` takes no binding.

### Bound style members

A Binding is `{ "bind": "<value key>" }` in place of a literal. The member reads that value each
time the activity is drawn, so an update that sends a new value changes it. Seven style members and
the two tints of the layout take a binding:

| Member | The value it names |
| --- | --- |
| `color`, `background`, `tint`, `layout.background`, `layout.keyline` | a string: a color name or a hex color, `#RRGGBB` or `#RRGGBBAA` |
| `size` | a number from 6 to 96 |
| `opacity` | a number from 0 to 1 |
| `cornerRadius` | a number from 0 to 64 |
| `weight` | a string: one of the nine weight names |

- A binding has one member, `bind`, and its value is a value key. Another member, a `bind` that is
  not a string or a key that names no value is `INVALID_INPUT`.
- A bound color cannot be a light and dark pair. A value is a string, a number or a boolean, and an
  object is not a value. A color name follows the appearance on its own (`primary`, `secondary`,
  `accent` and the system colors); a hex color looks the same in light and dark mode.
- The value must be one the member takes as a literal. At start every layer checks it against
  `snapshot.values`. On every update the native layer checks the new value the same way, because
  it keeps the styles. A value that does not fit is `INVALID_INPUT`, like any other value error.
- A style that no node uses is checked all the same. A bound `size` and a `font` exclude each other,
  as a literal `size` does. A style whose only members are bound is not empty.
- The other members take no binding: `font`, `design`, `monospacedDigit`, `lineLimit`,
  `minimumScaleFactor`, `alignment`, `padding`, `frame` and `buttonStyle`. They decide the text
  style, how text wraps, the space a node takes and the shape of a button, which belong to the tree
  and are fixed with it. Members of nodes, such as `spacing` or a literal `value`, take no binding
  either. To change any of these, end the activity and start a new one.
- A bound `size` changes the space its text takes. Give the node a `frame` when the rest of the row
  must not move.
- A binding counts toward the weight as the object it is: `{ "bind": "tone" }` weighs
  2 + (4 + 3 + 6 + 1) = 16.

On iOS, activitykit's renderer (`ActivityKitUI`) reads a bound member from the snapshot's values
every time it draws, and `ActivityKitLayoutWidget` passes the values to
`LayoutDocument.background(values:)` and `keyline(values:)` for the two tints. Android draws no
styles, bound or literal: `layout.styles`, `layout.background` and `layout.keyline` stay in
`degradedFeatures` as before.

The Rust crate carries the Rust validator, which is activitykit's since 0.4, and the Android
layer, and brings in activitykit for iOS. A crate of 0.2.x rejects a binding
with `INVALID_INPUT`, and the npm package of 0.2.x has no type or helper for it. Use the npm package
and the crate of the same minor version. The same holds for `fontFamily`, `file` sources and `custom`
nodes, which a crate of 0.2.x rejects.

### Custom nodes

```jsonc
{ "type": "custom", "name": "ring", "props": { "level": { "bind": "done" }, "label": "Bowl", "width": 4, "pulse": false } }
```

A `custom` node draws a SwiftUI view that the app registers under `name` in the widget extension
(`LiveActivityCustomViews.swift`, [Usage](usage.md#custom-swiftui-views)). It has no children and
counts as one node; it may stand in any region and inside a button, and takes `style`, `if` and `unless`
like any node.

- `props`, when present, has 1 to 16 entries. A key follows the rule of value keys. A value is text of
  0 to 200 code points, a number from -8640000000000000 to 8640000000000000, a boolean, or a binding
  `{ "bind": "<value key>" }` that names a key of `snapshot.values`, of any type. `null`, arrays and
  other objects are `INVALID_INPUT`.
- The view gets the literal props as they are and each bound prop with the value of the current
  snapshot, so an update redraws it with new values.
- The validators check the name and the props only. Whether the app has a view of that name, and what
  the view draws, they cannot check.
- On iOS a node whose name has no view draws nothing, and the record lists `layout.custom.<name>` in
  `degradedFeatures`, once for each such name of the layout in document order, region by region.
  activitykit reads the names from the `ActivityKitCustomViews` class in the app target, which
  `LiveActivityCustomViews.swift` defines; without it, every name is listed. Android draws no custom
  node and lists `layout.custom`.
- A binding weighs as the object it is, like a bound style member.

### Images the app writes

`write_image` takes `{ input: { name, png } }`, where `png` is the PNG file as an array of bytes
(integers 0 to 255). `writeImage(name, png)` in JavaScript sends a `Uint8Array` or an `ArrayBuffer`
this way; Rust's `write_image(name, &bytes)` and `check_image(name, &bytes)` take a byte slice.

| Rule | Error |
| --- | --- |
| `name` follows the rule of a `file` source: `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$` | `INVALID_INPUT` |
| an unknown member, or `png` that is not an array of bytes | `INVALID_INPUT` |
| `png` starts with the PNG signature and an `IHDR` header of a width and a height of at least 1, and ends with the `IEND` chunk | `INVALID_INPUT` |
| `png` has at most 1048576 bytes, a width of at most 1224 and a height of at most 480 pixels | `PAYLOAD_TOO_LARGE` |
| iOS: the widget extension names an App Group (`ActivityKitAppGroup`) and the app has its container | `CONFIGURATION_REQUIRED` |

Rust checks the input, asks the native layer for the folder once and writes the file there, under a
hidden name first and then renamed over the old file; on iOS activitykit's Rust does the writing. The
folder is `activitykit/images` in the App Group container on iOS and `tauri-live-activity/images` in
the app's private files on Android. On desktop the input is checked
and the answer is `UNSUPPORTED_PLATFORM`. The command answers `null`. The widget reads the file each
time it draws, on start and on every update; a missing or unreadable file draws nothing.

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
at most 3584 in every layer. An update sends every value again, the bound ones included, so the
values that a binding reads take room in every update. A request over the limit fails with `PAYLOAD_TOO_LARGE`. The
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

The JSON Schema checks shapes, ranges and patterns, including the characters allowed in `d`, the
shape of a binding (`$defs/bound`), the props of a custom node and `fontFamily` beside `design`. It
leaves the grammar of `d`, `min` below `max`, lone surrogates, the structural limits, the reference
rules (the values of bound members and the bindings of props among them) and the weight to the
validators: activitykit's in Rust and Swift, the plugin's Kotlin and `tools/validate-request.mjs`,
which check those as well and give the results the fixtures record. The tool checks a request against the definitions of its
own contract version only, so a v1 request gets the same issues as before v2.

### Differences from the RFC draft

- A start carries `snapshot` with the revision, as in v1, instead of top-level `values` and
  `staleAt`.
- The layout is fixed at start: `update_layout` takes no `layout`. Not in the draft: seven style
  members and the two tints can be bound to values, so an update changes them.
- Not part of 2.0: `layoutRef`, gradients, borders and `contentTransition`. The draft's
  `image.source.appGroup` became `{ "file": name }`, with the App Group configured once in the widget
  extension instead of named in every request. Custom fonts came as the style member `fontFamily`, and
  custom views as the `custom` node.
- Member names: `timerText` takes the value keys `start` and `end` instead of `startedAt` and
  `endsAt`, `symbol` takes `variableBind` instead of `variableValue`, and `layout.background` and
  `layout.keyline` replace `activityBackgroundTint` and `keylineTint`. `rendering` and `design`
  spell out `monochrome` and `monospaced` where the draft wrote `mono`.
- A `symbol` has no `weight`, a `progress` has no `tint` (tint is a style member) and a style has
  no `truncation`. A `path` takes a `box` and an optional `stroke` width, and is filled without
  `stroke`.
