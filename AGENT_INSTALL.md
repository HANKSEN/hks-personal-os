# Agent Install-only Compatibility Protocol

`AGENT_SETUP.md` is the primary protocol for new users. It installs the Skill and then continues into workspace selection, initialization, health verification, and onboarding.

For an existing managed installation, do not reinstall over it. Follow `AGENT_UPDATE.md` to preview and apply an integrity-checked update or activate an installed rollback version.

Use this compatibility protocol only when the user explicitly asks to **install the software and stop**.

1. Read `AGENT_SETUP.md`, `SKILL.md`, and `docs/safety.md`.
2. Explain that the default is Skill-first: the Skill includes its deterministic runtime and no global CLI is needed.
3. Preview every install destination:

```bash
node scripts/install.mjs setup --agent <target> --install-only --dry-run --json
```

4. After software-install approval:

```bash
node scripts/install.mjs setup --agent <target> --install-only --yes --json
```

5. Add `--with-cli` only when the user explicitly requests terminal or automation access.
6. Verify the reported Skill target contains `SKILL.md`, `AGENT_SETUP.md`, and `scripts/pos.mjs`.
7. Report the installed version, Skill locations, embedded runtime, optional CLI status, restart requirement, and backup warning.

This authorization does not allow initialization, reading, auditing, migration, or reorganization of any personal data directory. If the user wants to continue, resume at section 2 of `AGENT_SETUP.md` and obtain the next separate authorization.
