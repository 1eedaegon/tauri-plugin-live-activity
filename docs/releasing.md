# Releases

Both registries use `tauri-plugin-live-activity` and the same version. The
[Publish workflow](../.github/workflows/publish.yml) handles packaging and upload.

1. Run the native checks for what the release claims, on emulators, simulators and
   devices, and record the results in [validation.md](validation.md).
2. Update npm, Cargo and demo versions and lockfiles; commit and push to `main`.
3. Wait for the CI run of that commit on `main`. It must succeed.
4. Push the matching tag on that commit, for example `v0.2.0`.

CI's first job looks at what a push or pull request changed and runs only the jobs for those
parts: Rust, TypeScript, Swift or Android. A change to docs alone runs that first job only.
The run still ends in success, so the release guard accepts it for a tag on that commit.
Changes to a workflow or to the shared fixtures run everything, as does a run by hand.

A published version cannot be replaced, so a bug found after step 4 needs a new version.
Each commit on `main` gets its own CI run, and a later push does not cancel it. If that
run fails for a reason outside the code, rerun it with `gh run rerun <run id>`: the
rerun keeps the same commit.

The workflow checks that the tagged source belongs to `main`, both package
versions match, and CI passed at that exact commit. It packages without publishing
credentials, checks registry identity, and publishes missing versions in separate
jobs. Prereleases use npm's `next` tag; stable versions use `latest`. The workflow
passes the tag to `npm publish` with `--tag`, and npm prefers that flag to
`publishConfig.tag` in package.json. An existing version with different bytes or
a yanked Cargo release stops the workflow.

Once a stable version is on `latest`, the workflow also moves `next` to it if `next`
is missing or points to a lower version, then waits until the registry shows the
change. After a stable release, `npm install tauri-plugin-live-activity@next`
installs that release or a newer prerelease. This `next` update never moves `next`
to a lower version, and a prerelease run changes `next` only by publishing to it.
Publishing itself does not compare versions: a backport tag, such as `v0.1.1-rc.1`
after 0.2.0, is still published with `--tag next` (or `--tag latest` when stable)
and moves that tag back.

Push one release tag at a time, and wait for its Publish run to finish before
pushing the next one. Runs for different tags can overlap, and the registry can take
minutes to show a tag change, so an overlapping run can read an old `next` and move
it below a prerelease published moments earlier.

To validate or retry an existing tag, run **Publish** from the Actions page on
`main`. Enter the tag and leave `publish` unchecked for packaging only. Enable it
to publish missing packages. This supports tags created before the workflow was
added; do not move a release tag or overwrite an existing version. With `publish`
enabled, a stable version that is already on npm is checked again and `next` catches
up to it, so fixing `next` needs no npm login. Dispatch the stable tag that `latest`
points to: the `verify npm` step expects `latest` to point to the stable version it
checks, so for any other version it fails before `next` is checked.

To make an already-published version the default npm install, enable
`promote_latest` on a manual run. This also updates the version from which npm
selects its package-page and search metadata. It verifies the existing release
before changing the tag and waits for registry propagation afterward. Keep this
unchecked when preserving a stable default while publishing a prerelease to `next`.
A stable version pushed as a tag is published to `latest` directly and does not need
it. For a stable version, that first check also expects `latest` to point to it
already, so `promote_latest` cannot undo a stable backport that moved `latest` back.

## One-time registry setup

In each registry's Trusted Publishing settings, authorize GitHub Actions with:

| Field | Value |
| --- | --- |
| Owner | `1eedaegon` |
| Repository | `tauri-plugin-live-activity` |
| Workflow filename | `publish.yml` |
| Environment | Leave empty |

For npm, allow direct **npm publish**. Staging permission alone will not publish
the package. Also enable **Allow npm dist-tag**: `promote_latest` and the `next`
update after a stable release need it, because npm treats tag management as a
separate permission. The initial trust configuration requires account authentication;
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
