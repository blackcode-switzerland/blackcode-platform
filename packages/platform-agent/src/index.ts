// @blackcode/platform-agent — the agent surface every app shares.
//
// Two things live here, and both pass the test that decides what gets extracted:
// a second app needs them UNCHANGED.
//
//   changelog    the dated record, merged across every app into one feed
//   cli-version  the CLI versions the API advertises, and the hard floor —
//                read live from npm dist-tags, so a release needs no deploy
//
// `changelog` is the clearer case of the two. Architecture §7.3 makes the feed
// explicitly cross-app: one authored file per app in `docs/changelog/`, merged by
// date, each entry tagged with where it came from. Files are DISCOVERED by
// reading the directory, so adding an app is adding a file — a sales app needs
// not one line of this changed, and if it had its own copy the two would disagree
// about what "merged" means the first time either was touched.
//
// `cli-version` is one binary's version pair (§6: one binary, one login, one
// token, one version floor). Two apps advertising two different floors for the
// same `bk` would be two answers to a question that has one.
//
// ---------------------------------------------------------------------------
// WHAT DELIBERATELY DID NOT MOVE
// ---------------------------------------------------------------------------
// The Phase 2 table also listed the llms.txt renderer, the /agent-updator page
// and the CLI-parity harness for this package. They stayed in apps/issues, each
// for the standing reason — "if you have to add a parameter to make it generic,
// leave it":
//
//   agent-manifest.ts + /llms.txt — the manifest is this app's identity (its
//     name, its npm package, its funnel copy). A platform version would be a
//     renderer taking a ten-field config object, which is the parameter case
//     verbatim; and each app serves /llms.txt on its own domain with its own
//     wording anyway.
//
//   /agent-updator — a React page built on this app's marketing layout and this
//     app's copy. It is a page, not shared logic.
//
//   cli-parity.test.ts — genuinely reusable in shape, but "the parity test runs
//     per app" is a Phase 8 guardrail deliverable, and extracting the harness
//     without the per-app wiring it exists to enable would leave a parameterised
//     harness with exactly one caller.
//
// Under-extracting is cheap to fix when the second app asks. Over-extracting is
// not, which is why each of these has a reason written down rather than a TODO.

export {
  PLATFORM_APP,
  getChangelog,
  getChangelogApps,
  getChangelogFor,
  getChangelogMarkdown,
} from './changelog'
export type { ChangelogEntry, ChangelogPayload } from './changelog'

export { CLI_PACKAGE, getCliVersions, createCliVersionSource } from './cli-version'
export type { CliVersions, CliVersionSourceOptions } from './cli-version'
