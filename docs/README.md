# Developer docs

Installation and a short example are in the [README](../README.md)
([한국어](../README.ko.md)). What the current release was tested on is in the
[validation record](validation.md).

| Guide | Contents |
| --- | --- |
| [iOS setup](ios-integration.md) | Shared models, the Widget Extension, permissions and end policies |
| [Android setup](android-integration.md) | Notification permission, promotion, state recovery and limits |
| [Validation](validation.md) | Test, emulator and packaging results |
| [Releases](releasing.md) | The publish workflow and the registry setup |
| [Demo app](../examples/demo/README.md) | How to run it, and lifecycle checks through the real bridge |

## Research notes

Researched on 2026-11-04. A **proposal or plan** in these documents does not mean that it
is implemented or that it works on a device. Sources and SDK versions are checked again
when they are pinned and native builds run.

| Document | Contents |
| --- | --- |
| [Development environment](development.md) | What is installed, what remains, expected memory and disk use |
| [OS compatibility](compatibility.md) | Features by version, device matrix, display and lifetime limits |
| [Permissions](permissions.md) | Setup versus user consent, signing and distribution |
| [Architecture](architecture.md) | Alternatives, the chosen structure, the API contract, platform adapters |
| [Implementation and release plan](testing-and-release.md) | The original plan: stages, compatibility tests, release conditions |
| [References](references.md) | Official docs, repositories studied, license conventions |
| [Research review](review.md) | Design problems found, what changed, follow-up work and open conditions |
| [Request contract](request-contract.md) | Executable input schema and fixtures, and who checks what |
| [Layout DSL RFC](rfc-layout-dsl.md) | The proposal for request contract v2: widget UI written from Tauri (interpreter widget, style tokens, icon channels, actions) |

The first test devices planned were an iPhone XS, an iPhone 16, a Galaxy Note10 and a
Galaxy S23. When this was written, which of them were at hand, their OS and One UI
versions and the developer accounts had not been confirmed. The scope is iOS, Android,
macOS, Windows and Linux. iPad and Apple's secondary display devices are checked
separately. Four phones do not certify desktop support.
