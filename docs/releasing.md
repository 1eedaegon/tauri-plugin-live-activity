# Releases

Both registries use `tauri-plugin-live-activity` and the same version. The
[Publish workflow](../.github/workflows/publish.yml) handles packaging and upload.

1. Update npm, Cargo and demo versions and lockfiles; commit and push to `main`.
2. Wait for CI and complete the relevant native emulator checks.
3. Push the matching tag, for example `v0.1.0-alpha.4`.

The workflow checks that the tagged source belongs to `main`, both package
versions match, and CI passed at that exact commit. It packages without publishing
credentials, checks registry identity, and publishes missing versions in separate
jobs. Prereleases use npm's `next` tag; stable versions use `latest`. An existing
version with different bytes or a yanked Cargo release stops the workflow.

To validate or retry an existing tag, run **Publish** from the Actions page on
`main`. Enter the tag and leave `publish` unchecked for packaging only. Enable it
to publish missing packages. This supports tags created before the workflow was
added; do not move a release tag or overwrite an existing version.

## One-time registry setup

In each registry's Trusted Publishing settings, authorize GitHub Actions with:

| Field | Value |
| --- | --- |
| Owner | `1eedaegon` |
| Repository | `tauri-plugin-live-activity` |
| Workflow filename | `publish.yml` |
| Environment | Leave empty |

For npm, allow direct **npm publish**. Staging permission alone will not publish
the package. The initial trust configuration requires account authentication;
subsequent releases use short-lived OIDC credentials. No npm or Cargo publishing
token is stored as a GitHub secret.

[npm trusted publishing](https://docs.npmjs.com/trusted-publishers/),
[crates.io trusted publishing](https://crates.io/docs/trusted-publishing).

## Alpha.3 migration

The frozen [alpha.3 manifest](../tests/release/alpha3-artifacts.json) records the
source commit and artifacts already tested in native Tauri apps. The workflow
requires an identical Cargo archive and identical complete npm tar contents,
including headers, when finishing this release. Nix Node and official Node use
different zlib builds, so gzip bytes differ even though the decompressed tar is
identical. Its frozen SHA-256 anchors that comparison; the published gzip archive
has its own SHA-1/SHA-512 checks. Cargo alpha.3 is already public and is skipped
after checksum verification.

For a historical-tag dispatch, the workflow commit can differ from the package
source. npm provenance uses the workflow commit, so the workflow disables it for
that case rather than attributing the package to the wrong source. Normal tag
pushes retain provenance. The release artifact always records the resolved source
commit, successful CI run and package checksums.
