---
name: personal-os
description: Route personal tasks and files into a safe local Personal OS, retrieve bounded context, and prepare reviewable reversible changes.
---

# Hks Personal OS host adapter

This directory is the plugin discovery adapter. The canonical Skill and runtime are at the plugin root.

1. Read `../../SKILL.md` completely before acting.
2. For installation or initialization, read `../../AGENT_SETUP.md`.
3. For updates, read `../../AGENT_UPDATE.md`.
4. Run the deterministic runtime with `node ../../scripts/pos.mjs` unless the optional global CLI is explicitly installed.
5. Keep all safety, approval, backup, context-loading, Changeset, and return-contract rules from the canonical Skill.

Resolve every relative path from this adapter directory. If the host copied the plugin into a cache, do not access files outside the copied plugin root.
