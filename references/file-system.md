# File System and Asset Model

## Decision order

Choose one canonical physical location by asking, in order:

1. Does this advance a current outcome with a finish condition? Use `10_Projects/<project>/`.
2. Is this a durable asset owned by an ongoing responsibility? Use `20_Areas/<area>/`.
3. Is it classified external material with no current owner? Use `30_Resources/`.
4. Is its purpose still unknown? Keep it in `00_Inbox/`.
5. Is it inactive, completed, or obsolete? Move it to `90_Archive/`.

Do not choose a location merely from the topic. Choose by current actionability and ownership.

## Area assets

An Area may contain:

- `Knowledge/`: the user's understood, reusable explanations and models.
- `Experience/`: dated actions, decisions, experiments, outcomes, and reviews.
- `Principles/`: evidence-backed rules, playbooks, methods, and SOPs.
- `Artifacts/`: published articles, videos, reports, Skills, software releases, and other deliverables.
- `Data/`: structured measurements, exports, metrics, and factual records.

The initializer creates these five semantic lanes for every requested Area so placement is visible to a new user. They may remain empty, and users may add their own status subdirectories without changing the asset meanings.

## Project lifecycle

Keep research, outlines, drafts, generated media, and working data in the Project while producing an outcome. When work finishes:

- Promote the maintained final output to the owning Area's `Artifacts/`.
- Promote reusable understanding to `Knowledge/`.
- Record the time-bound outcome and review in `Experience/`.
- Promote a stable reusable method to `Principles/` only when evidence supports it.
- Archive the Project as a unit and keep links to the promoted canonical assets.

## Resources versus Knowledge

- Resource means: an external source has been classified and retained.
- Knowledge means: the user or agent has synthesized an understanding that can guide later action.

Never silently convert an imported source into a statement of the user's belief.

## Canonical-copy rule

Keep one formal canonical copy. Use relative Markdown links, stable IDs, or the generated index to expose an asset from other Areas and Projects. A working draft and a published final version may both exist when their lifecycle roles differ, but only one is the canonical published Artifact.
