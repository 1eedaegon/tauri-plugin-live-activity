# Mochi companion screen

The demo presents two small activities: a snack arriving for Mochi and a short
nap. The primary job is to start an activity, move its state forward, and finish
it while the same state appears on the phone's native activity surface.

The previous screen placed request fields and raw JSON ahead of the activity.
Keep those diagnostics available in a collapsed Developer tools section. The
first viewport should instead show Mochi, the selected activity, its state, and
one primary action. The illustration is a compact cat drawn in local SVG; no
external assets or network font requests are needed.

Visual direction: warm cream, dark brown text, restrained coral actions, and teal
progress. A small stitched-label motif belongs to the pet's delivery, rather
than adding decoration throughout the page. Use rounded system typography,
ordinary sentence case, and generous touch targets. Avoid gradients and nested
cards. Snack and nap tabs change the scene and can restore their own native
record without modifying another activity.

A third tab, Layouts, picks one layout example at a time from a row of chips. It
shows the example's name, one sentence on the feature, one on what Android shows,
and its start request in a collapsed section. Starting an example ends the other
layout examples, so each native surface shows one feature for a screenshot.

Target viewports: 390x844 and 1440x900. The activity panel stays narrow enough to
read on desktop, while the illustration and controls share the wide layout.
No horizontal scrolling at 320px. Touch controls are at least 44px, focus remains
visible, and motion respects reduced-motion settings.

| State | Trigger | Visible feedback | Next action |
| --- | --- | --- | --- |
| Loading | Initial native reads or an operation | Stable scene, busy action label, polite status | Wait; controls return after the result |
| Empty | No record for the selected activity | Ready-to-start scene and a clear start action | Start delivery or start nap |
| Error | Native rejection or unavailable bridge | Specific plain-language message in the status area | Retry, refresh, or follow permission action |
| Partial | OS observation pending or desktop unsupported | Pending observation message, or explicit device requirement | Refresh or use a mobile build; no false active claim |
| Success | Snack reaches home or activity ends | Delivered/completed message and next action | Finish or start again |
| Permission | Notification access missing or Live Activities disabled | Brief reason and platform-appropriate permission/settings action | Explicit user-triggered permission check/request |

The native lifecycle runner keeps its existing 13 assertions and opt-in startup
flag. Browser QA may inject a test IPC adapter to inspect UI states; such captures
are UI preview evidence only. Published-package native tests and final native
screenshots are recorded separately.
