# Alpha implementation contract

Inputs follow [request schema](../../contracts/request.schema.json). Unicode lengths
count code points. Numbers are finite and JS safe; null/unknown fields are rejected.
Native code additionally enforces encoded ActivityKit size and OS lifecycle policy.

Records contain id, activityKey, schemaVersion, template, snapshot, backend, state,
visibility, degradedFeatures, promotionRequested and promotionState. Backends are
activityKit/androidNotification/unsupported. States are active/stale/ended/dismissed/unknown.
Visibility is unknown. Promotion state is promoted/notPromoted/unknown/notApplicable.

Capabilities contain platform, backend, start/update/end/progress/timer/actions/
stateObservation/silentUpdate/nativeLiveActivity and maxPayloadBytes. Feature values
are supported/unsupported/unknown. Permission results contain notifications,
liveActivities and promotion using granted/denied/prompt/settingsRequired/
notApplicable/unknown. Request kinds are notifications/liveActivities/promotion.

Tests cover serialization parity, boundary rejection, duplicate/conflicting starts,
old/conflicting revisions, ending twice, unknown handles, generation isolation,
permission denial, OS fallback, process restart/reconciliation, and real bridge use.
Native framework limitations and any unmeasured coverage are recorded explicitly.

References: [official plugin guide](https://v2.tauri.app/develop/plugins/),
[mobile bridge guide](https://v2.tauri.app/develop/plugins/develop-mobile/), and the
official Tauri 2.12.4 CLI plugin template generated locally before implementation.

For the supported-version audit, use version-pinned native/Tauri sources and vendor
API references. Exercise Android notification/channel/permission/promotion boundaries
where emulator images exist. Check Apple deployment-target compilation separately
from simulator runtime availability. Reports identify registry artifacts versus
workspace changes and never count an unavailable runtime as a passing test.
