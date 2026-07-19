# Changelog

## 1.1.0 (2026-07-19)

- Make setup Skill-first: the versioned Skill package includes the deterministic runtime, while global `pos` / `personal-os` links are installed only with `--with-cli` or the legacy compatibility entry.
- Add a resumable `personal-os.setup.v1` journey that continues from software installation into new-root or existing-directory onboarding with separate authorization gates.
- Add staged new-root initialization, `START_HERE.md`, health verification, and a first-real-task handoff for beginner use.
- Add read-only existing-directory audit, lifecycle/duplicate/conflict findings, six migration reports, and reviewed copy-to-new-root migration with hash and provenance verification.
- Publish a curated design-foundation layer and accepted RFCs without exposing internal Specs, personal context, raw conversations, or private roadmap material.
- Add source-to-principle-to-rule-to-test provenance for PARA, Agent Skills, context files, prompt-injection controls, and the project's original extensions.
- Change new-version software licensing to AGPL-3.0-or-later and original explanatory documentation to CC BY-SA 4.0, with a separate commercial-license path.
- Preserve the irrevocable MIT terms for the previously published v1.0.0 tag and clarify that user-created Personal OS content is not automatically covered by project licenses.
- Require a separate contributor agreement before merging substantive third-party contributions so commercial relicensing remains possible.
- Keep `SKILL.md` frontmatter to the Codex-compatible `name` and `description` fields; repository-level files define the license scope.
- Add target-release-driven, Skill-first software updates with SHA-256 package manifests, immutable version directories, software-only install state, preview and approval gates, atomic managed-link switching, and automatic link restoration on failure.
- Add rollback to an already installed version while retaining the explicit boundary that software rollback never discovers or reverses Personal OS data.
- Add `AGENT_UPDATE.md`, bilingual update guides, and isolated upgrade, rollback, tamper, privacy, CLI-preservation, and transaction-failure tests.
- Isolate temporary AI work by the actual Agent Host under `99_AI/hosts/<host-id>/runs/`; keep `research / creator / builder / reviewer` as Skill Role Profiles rather than physical user-data directories.
- Add explicit cross-host handoffs, task v2 Host/Role provenance, nested Doctor checks, and complete `99_AI` exclusion from durable-asset retrieval.
- Add preview-first `workspace-upgrade` for existing data roots, conservatively mapping unknown historical Runs to `legacy`, preserving old Apply/Undo history, refusing conflicts, and restoring data after transaction failure.

## 1.0.0

- Publish the first stable Hks Personal OS release.
- Provide a local-first PARA file system with explicit Knowledge, Experience, Principles, Artifacts, and Data boundaries.
- Add intent clarification, bounded context retrieval, isolated Agent Runs, reviewable Changesets, audit history, rollback, and diagnostics.
- Add versioned user-local installation for generic Agents, Codex, Claude Code, and documented custom Skill directories.
- Add GitHub one-command installation and a cross-Agent installation protocol for Codex, Claude Code, WorkBuddy, QCode, Kimi, and compatible hosts.
- Include bilingual onboarding, backup guidance, security boundaries, disclaimers, and 50 isolated tests.

## 0.2.0

- Add a versioned user-local installer exposed as the `personal-os` package binary.
- Add GitHub one-command installation, dry-run previews, generic/Codex/Claude/custom Skill targets, collision refusal, and packed-artifact verification.
- Add the cross-Agent `AGENT_INSTALL.md` protocol for Codex, Claude Code, WorkBuddy, QCode, Kimi, and other local Agent hosts.
- Add bilingual installation, backup, safety, risk, and disclaimer documentation.
- Add isolated installer tests that use only synthetic HOME, data, binary, and Skill directories.

## 0.1.0

- Add Personal OS file and context protocols.
- Add Starter Kit templates.
- Add deterministic local CLI with indexing, context retrieval, task runs, Changesets, rollback, and diagnostics.
- Add isolated fixture tests and security checks.
- Add canonical path-identity checks, protected-context alias defense, per-operation revalidation, and sealed undo-history integrity checks.
- Add JSON help, process-level CLI undo coverage, and a reproducible Skill forward-evaluation protocol.
