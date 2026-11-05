# Alpha system design

The [architecture proposal](../architecture.md) remains the design rationale.
JS calls seven Tauri commands: get_capabilities, check_permissions,
request_permissions, start, update, end, list. Start/update/end receive `input`;
request_permissions receives `kind`. Tauri ACL defaults grant queries only.

Rust validates shared JSON requests before platform dispatch, serializes stable
errors `{code,message}`, and exposes the same API to native Rust consumers.
Native commands receive direct validated input and respond with an internal envelope
`{ok:true,data}` or `{ok:false,error:{code,message}}`. The public API unwraps it.
OS lifecycle and reconciliation belong to the native backend; no Rust in-memory
state is mistaken for persistent OS state.

iOS shares one attributes module between the Swift plugin and host widget.
Android owns a notification namespace and persists generation/revision metadata.
Both serialize mutations, preserve duplicate-request semantics, and report unknown
visibility. Native errors must not expose payloads, paths, or credentials.

Version gates belong to the backend that calls the native API. Build-tool minima
are recorded separately from runtime feature gates. Desktop fallback evaluation
must include update and removal semantics, observable errors, receipt recovery,
permissions and explicit capability degradation before selecting a library.
