# Working on Band Coach

Read [CONTRIBUTING.md](CONTRIBUTING.md) and the relevant README section before
changing code. Applicable parent/workspace governance still applies.

## Optional Ponytail plugin

Ponytail supplements this project's requirements. Its minimal-code and testing
guidance never reduces required TDD, validation, coverage, documentation, PR or
release obligations. A documented shortcut remains reviewable against those
requirements. Preserve validation, accessibility, data-loss protection and the
calibration real instruments need. Do not claim real-device verification from
automated tests.

Write and observe the failing test before implementing new behavior or a bug
fix. Use `tests/unit/` for pure logic and `tests/characterization/` for browser
behavior. An assert-based self-check does not replace the required test families
or release gate. Run the affected checks described in CONTRIBUTING and docs/ci.md;
update documentation with the change. Use a feature branch and open a PR.

Ponytail must not replace the existing statusline, change permission settings,
enable a webhook, or enable itself for other contributors. Do not install its
AGENTS.md over existing governance. The marketplace is opt-in and does not grant
permission to edit protected configuration paths or merge/release changes.

Follow [docs/ponytail.md](docs/ponytail.md) for the pinned source, privacy settings,
runtime writes, validation and removal. Treat plugin hooks as executable code;
agent instructions are not a sandbox for them.
