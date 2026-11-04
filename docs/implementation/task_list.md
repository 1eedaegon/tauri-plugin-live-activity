# Implementation and release checklist

- [x] Review existing research and official Tauri scaffold; establish alpha scope.
- [x] Document product, system design and shared bridge contracts.
- [x] Write failing Rust/JS/native tests and record the failures.
- [x] Implement and verify strict Rust boundary and desktop unsupported behavior.
- [x] Implement and verify JS client, packaging and demo host.
- [x] Implement and verify iOS backend and shared widget template.
- [x] Implement and verify Android backend and permissions/fallback.
- [x] Run native builds and emulator lifecycle tests; fix observed failures.
- [x] Review input handling, ACL, native lifecycle, dependencies and package contents.
- [x] Install packaged artifacts in a clean consumer and rerun relevant checks.
- [ ] Attempt crates.io and npm alpha publication after validation.
- [ ] Verify published versions/installations, or record exact external blocker.
