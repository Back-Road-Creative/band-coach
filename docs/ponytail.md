# Optional Ponytail setup for Band Coach

Ponytail is a developer tool, not part of the downloadable app, Pages build or
Store package. The full Claude Code plugin adds coding/review skills and a local
task dashboard. Band Coach's `.claude-plugin/marketplace.json` offers it as
`ponytail@band-coach-reviewed`, disabled by default. Checking out this repository
does not register, install or enable it. No shared settings enable it.

## Reviewed source and limits

- Upstream: [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail).
- Version: 5.3.3; exact commit `96608e078b2d5ea607c5c3b8b5a54d1c1fba6846`.
- Review: 2026-11-04, source inspection of all six skills, manifests, lifecycle
  hooks, dashboard data flow, import/cleanup scripts and agent adapters. Synthetic
  probes of dashboard handlers confirmed local logging, webhook behavior and
  HTML escaping; they did not test a live Claude session or every host integration.
- No evidence of credential theft or a hardcoded reporting destination was found.
  This is not a security certification, a review of the npm artifact, or approval
  of future upstream revisions.
- Consumer check: Claude Code 2.1.317 validated the catalog with `--strict` and
  installed it at local scope in a disposable configuration directory. Its
  installation record reported the exact SHA above, version 5.3.3 and
  `enabled: false`. Privacy options were saved while the plugin was disabled.
  This did not install into the operator's live profile or activate any hooks.

The catalog pins the full commit SHA, not a movable tag. `strict: false` leaves
the upstream manifest as the component source; the catalog adds no executable
components. Keep marketplace auto-update off. An upgrade changes the SHA and its
security-contract test together, records the new review here, and goes through a
PR. A version number alone does not establish that a revision was reviewed.

## Before activation

Use a local Claude Code terminal or desktop Code session with Node on PATH.
The upstream band requires Claude Code 2.1.290 or later; it does not render in
the VS Code chat panel, cloud sessions or `claude -p`.

Read CLAUDE.md and retain existing permission rules, statusline and hooks. Claude
command hooks run with the user's permissions outside the agent tool sandbox.
Local install scope limits where the plugin loads, not which files hooks can access.

Activation requires the operator's agreement to the following plugin-owned writes.
In a managed workspace, use its reviewed configuration process; this document
does not override a protected-path restriction:

| Location | Purpose |
| --- | --- |
| Claude's plugin cache and plugin configuration | Catalog registration, downloaded code and user options |
| Band Coach's `.claude/settings.local.json` | Personal enablement for this checkout; ignored by git |
| `$CLAUDE_CONFIG_DIR` (default `~/.claude`): `.ponytail-active`, `ponytail-modes/`, `.ponytail-band`, `.ponytail-statusline-nudged` | Mode, visibility and setup state |
| Same directory: `ponytail-statusline.sh` or `.ps1`, plus temporary copies during replacement | Startup may copy/refresh its optional badge script even before accepting the setup offer |
| `$XDG_CONFIG_HOME/ponytail` (default `~/.config/ponytail` on Linux/macOS) | `config.json` when changing the default mode; `band/` for task CSV files and `board.html` |

The reviewed activation hook reads Claude settings but asks the agent to offer
statusline setup; it does not itself change `settings.json`. Decline that offer:
the band above the prompt works independently of the optional statusline badge.
The dashboard reads source definitions and the current session transcript.
`/ponytail band import` separately reads past sessions across projects; leave
that command unused during the trial.

## Install for yourself in this checkout

After the integration PR is reviewed, open Claude Code in the Band Coach checkout.
Use the durable checkout as the catalog location, not a temporary worktree that
will be removed. Register the local catalog:

```text
/plugin marketplace add ./
```

Open `/plugin`, find `ponytail` in `band-coach-reviewed`, and choose **Install for
you, in this repo only (local scope)**. Do not choose user-wide or shared project
scope. The catalog starts disabled. Keep auto-update off on the
`band-coach-reviewed` marketplace. Do not also install the upstream
`ponytail@ponytail` copy; that would introduce another independently updated source.

While it is still disabled, configure it with:

```text
/plugin configure ponytail@band-coach-reviewed
```

Set the options below. Review its components, then explicitly enable it at local
scope once the runtime writes above are accepted. Restart the session to apply
the settings. Enabled plugins also expose ordinary options in `/config`.

| Option | Value |
| --- | --- |
| Task board (`ledger`) | On, for local history |
| Webhook URL (`webhookUrl`) | Empty |
| Webhook token | Unset; no token is needed |
| Send task names (`sendNames`) | Off |

`sendNames: false` only removes names from webhook payloads, not local records.
Local task names come from the sidebar title or the first 60 characters of the
initial prompt. The board records project names, costs, tokens, timing and test
status. Treat those files and exported cards as work data when sharing or backing
them up. Never add an external reporting endpoint without a separate review and
authorization; managed credentials must follow the workspace's secret policy.

## Verify the trial

Start a fresh session, select `/ponytail full`, and use one small Band Coach change.
Confirm the band and local board work without replacing your existing statusline.
Check the actual work: a failing test first, required checks passing, docs updated,
a feature branch and PR. Do not accept an agent's promise as evidence of those steps.
The dashboard's test badge is a heuristic, not a replacement for CI results.

For the integration itself, run the offline security-contract test:

```sh
node --test tests/unit/ponytail-marketplace.test.mjs
```

The maintainer also validates the catalog with Claude's real consumer:

```sh
claude plugin validate .claude-plugin/marketplace.json --strict
```

That checks the catalog schema, not a live dashboard, the runtime privacy settings,
or whether an agent follows governance. Normal affected test families still apply.
No plugin installation, download or network call runs inside the tests or CI.

## Stop or remove

Disable `ponytail@band-coach-reviewed` in `/plugin` at local scope and restart the
session to stop the plugin. `/ponytail off` changes coding mode, and `/ponytail band
off` hides the display; neither stops dashboard logging. Turning off `ledger`
does not stop an independently configured webhook. Leave its URL empty.

Uninstall through `/plugin` when finished. Local CSV/HTML history and some mode or
badge files can remain. Review and remove only Ponytail-owned files through your
normal configuration process if you also want to erase that history. Do not run
the upstream cleanup script blindly: it can edit Claude settings and Cursor hooks,
and does not clear the dashboard history. Uninstalling is not data erasure.

References: [install scopes](https://code.claude.com/docs/en/discover-plugins),
[commit pinning](https://code.claude.com/docs/en/plugins/marketplace-reference),
[plugin trust](https://code.claude.com/docs/en/plugins/security).
