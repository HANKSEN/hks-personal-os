# Changelog

## 1.3.2 (2026-07-24)

- Make package metadata validation tolerant of Windows CRLF checkouts instead of treating valid Skill frontmatter as empty.
- Add a CRLF regression test for Skill frontmatter parsing.
- Add repository line-ending policy so source and documentation remain LF-normalized across Git clients while binary assets remain untouched.

## 1.3.1 (2026-07-24)

- Make executable-script validation platform-aware: Windows verifies shebangs and package entry points without requiring POSIX mode bits, while macOS and Linux keep execute-permission checks.
- Add regression coverage for Windows and POSIX executable metadata behavior.
- Upgrade GitHub Actions checkout and Node setup steps to v5.
- Run push validation only for `main`, avoiding duplicate workflow runs when a release tag points to the same commit.

## 1.3.0 (2026-07-24)

- Add a capability-graded Agent registry covering Codex, Claude Code, OpenClaw, Hermes Agent, WorkBuddy, CodeBuddy, TRAE, TRAE SOLO, and shared-standard fallbacks for other mainstream Agents.
- Detect hosts from real local signals and refuse to invent undocumented private Skill directories.
- Add official WorkBuddy/CodeBuddy plugin manifests, a plugin-discovered Skill adapter, and a plugin-root MCP configuration.
- Add a local no-write `diagnose` command that reports Node, terminal mode, host signals, planned targets, support grade, and acquisition risks.
- Separate software acquisition from workspace initialization for short-lived Agent shells.
- Add a checksummed release-bundle builder with a sub-1-MiB package budget for weak-network and offline installation.
- Remove README diagrams and candidate visual sources from the runtime distribution package while preserving them in the public repository.
- Add isolated regression coverage for every target class, plugin self-containment, detection evidence, offline diagnosis, and release size.

## 1.2.7 (2026-07-21)

- Treat Codex native MCP form elicitation as unsuitable for decision-critical structured approval because the host may flatten or normalize message layout.
- Route Codex MCP review calls to a fail-closed inline-visual handoff instead of opening the native form; no proposal decision or file write occurs during handoff.
- Keep MCP responsible for immutable proposal preview, status, digest validation, and deterministic execution while the Codex conversation card owns the review presentation.
- Preserve native MCP form elicitation for non-Codex clients that render it readably, with exact proposal-ID text confirmation as the final fallback.
- Add transport-level regression coverage proving a Codex client cannot accidentally enter native elicitation and that its proposal remains awaiting approval.

## 1.2.6 (2026-07-21)

- Fix generated Codex approval-card JavaScript where an unescaped newline inside the follow-up prompt join expression caused `Document.write` to fail with `SyntaxError: Invalid or unexpected token`.
- Add a parser-level regression assertion for every generated interaction script before release.
- Regenerate the live conversation demo with valid JavaScript while preserving proposal binding and deterministic revalidation.

## 1.2.5 (2026-07-21)

- Add a Codex conversation-native approval visual with summary cards, an exact file-operation table, write scope, risk, digest, optional note, protected-Context confirmation, and four explicit decisions.
- Make visual controls return a proposal-bound follow-up message through `window.openai.sendFollowUpMessage`; they never perform file writes directly.
- Require the Agent to re-read approval state and verify the exact proposal ID, `awaiting_approval` status, and full plan digest before calling deterministic `decide`.
- Add the `approval-visual` runtime command with explicit absolute output paths, no-overwrite behavior, HTML escaping, and refusal to render already-decided proposals.
- Keep MCP form elicitation and exact proposal-ID text confirmation as cross-host fallbacks.
- Add browser-rendered visual acceptance evidence and regression coverage for layout structure, button binding, injection escaping, overwrite refusal, and terminal-state refusal.

## 1.2.4 (2026-07-21)

- Use Unicode mandatory line separators in native MCP approval messages so Codex cannot collapse every approval section into one paragraph.
- Sanitize imported summary text to keep user-supplied line separators from escaping the intended approval structure.
- Add transport-level regression coverage for exact visual lines without relying on Markdown rendering.

## 1.2.3 (2026-07-21)

- Replace Markdown-dependent MCP approval messages with host-independent structured plain text.
- Group decision-critical information into stable labeled sections: plan, exact file changes, allowed write scope, and approval boundary.
- Keep full proposal/task identifiers in persisted approval records while showing only a short integrity digest in the decision surface.
- Make the native decision-field title include operation count and risk, so the form remains informative even when the host collapses message whitespace.
- Add regression coverage that verifies exact paths remain visible, generated Markdown formatting is absent, and section boundaries survive whitespace collapsing.

## 1.2.2 (2026-07-20)

- Separate Task identity from batch-level `changeId` / `undoId`, allowing one Run to contain multiple independently reviewed, applied, and reversible Changesets.
- Fix a critical rollback-isolation bug where a rejected second apply under an existing history key could delete the first committed history directory.
- Keep the 25-operation human-review boundary while returning deterministic batching guidance instead of requiring a new Task for every batch.
- Add create-only `opaque-copy` mode for staged files up to the policy limit, with streamed SHA-256 validation, atomic byte-preserving copy, bounded preview metadata, and no forced compression.
- Bound text diffs and MCP proposal payloads so large single-line files cannot flood the Agent conversation transport.
- Return a retryable `awaiting_approval` result when native elicitation times out; no proposal decision or formal write occurs.
- Diagnose applied approval records whose Undo history is missing.
- Make reviewed copy migration generate distinct batch IDs, filenames, staging paths, and automatic opaque-copy operations for large assets.
- Add production-incident regression coverage for history preservation, multi-batch Undo, large-file copy, bounded previews, timeout recovery, and missing-history diagnosis.

## 1.2.1 (2026-07-20)

- Restructure the native approval prompt as Markdown with a title, summary table, complete file-operation list, write scope, and immutable plan digest.
- Localize the approval decision, optional note, protected-context confirmation, and all four decision labels into Simplified Chinese.
- Preserve readable line hierarchy even when an Agent host displays the Markdown source as plain text.

## 1.2.0 (2026-07-20)

- Add immutable approval proposals that bind task, host, operations and a SHA-256 plan digest; changed, expired or already-consumed proposals cannot authorize a write.
- Add `propose`, `decide`, and `approval-status` runtime commands with approve, revise, reject and cancel outcomes.
- Add a zero-dependency stdio MCP adapter that renders native form elicitation when supported and fails closed to an exact proposal-ID text confirmation otherwise.
- Detect supported Codex and Claude Code host integrations during installation and enable the interactive approval adapter by default, with collision refusal and `--no-interactive-approval` opt-out.
- Keep protected Context behind a separate approval control and retain the existing Changeset, transaction, audit and Undo boundaries.
- Add approval protocol, MCP negotiation, fallback, stale-plan and protected-content tests, plus a local Orange Editorial approval demo.

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
