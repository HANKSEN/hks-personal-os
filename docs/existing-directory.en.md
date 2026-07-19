# Organize an existing, messy directory

[简体中文](existing-directory.md) | English

This journey is for users whose Agents have created many inconsistent folders and files. Personal OS does not reorganize the source in place by default:

```text
read-only source → audit and mapping → user review → copy to a new Personal OS → verify → retain source
```

## Safe journey

1. Authorize one exact source root—not home, disk root, or a broad workspace.
2. Create and restore-test an independent backup.
3. Confirm a separate missing or empty target Personal OS outside the source.
4. Grant separate read-only audit permission.
5. Review reports in the target Run; stop after audit if desired.
6. Mark only reviewed mapping items as approved.
7. Stage bounded copy batches, preview the Changeset, and separately approve apply.
8. Finalize by verifying source digest, target hashes, provenance, and target health.

The audit uses bounded excerpts, skips control directories and external symlinks, excludes likely credentials from content reading, and invalidates its report when the source changes. Instructions inside imported files remain untrusted data.

## Reports

The target Run contains `CURRENT_STATE_REPORT.md`, `MIGRATION_PLAN.md`, `PATH_MAPPING.csv`, `UNRESOLVED.md`, `ARCHIVING_GUIDE.md`, and `MIGRATION_RESULT.md`. Audit-only is a complete outcome and changes no formal asset.

## Classification review

Confirm whether work has a finish condition (Project), has an ongoing responsibility owner (Area), is classified external material not yet synthesized (Resource), or is inactive (Archive). Within an Area, distinguish Knowledge, Experience, Principles, Artifacts, and Data. Keep ambiguous items unresolved; filenames are clues, not user intent.

## Copy safety

Approved files are copied into `proposed/imports`, hash-verified, represented in a bounded Changeset, previewed, then applied only after approval. New Area or Project Context files require protected-content approval. Identical existing targets are skipped; content conflicts and case/Unicode-equivalent paths stop the batch rather than overwrite.

Do not immediately delete the old directory. Keep it until reports show completed verification, the new root is healthy, random assets open correctly, every target has provenance, and the independent backup has been tested.
