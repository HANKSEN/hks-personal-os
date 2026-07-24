# Weak-network and offline installation

`npx --package=github:...` obtains the repository before the Personal OS installer starts. Exit `137 / SIGKILL` only proves that the process was terminated; network latency, an Agent command deadline, memory pressure, or cache permissions can all produce similar symptoms.

Use this distribution order:

1. checksummed release `.tgz`;
2. published npm package with a configurable trusted registry;
3. shallow Git or GitHub source when the network and command deadline allow it;
4. an offline local `.tgz` passed to the Agent.

Maintainers build the release package with:

```bash
npm run release:bundle -- --output dist
```

The output includes the package, `release-manifest.json`, and `SHA256SUMS`. The package must stay below 1 MiB and excludes visual source files, tests, Git history, personal data, private Specs, and internal task records.

Install a downloaded or attached package:

```bash
npx --yes --package=./personal-os-<version>.tgz personal-os setup \
  --agent auto --install-only --yes --json
```

Continue workspace selection and initialization in a later Agent turn. Do not combine network acquisition and personal-data authorization in one long command.

An npm mirror may be documented only after the exact package is available there. Every channel must distribute byte-identical content with the same version, provenance, license, and SHA-256. Unknown GitHub proxy domains are not a default installation source.

If the host still kills installation, report the stage, exit code, elapsed time, available memory, tool versions, and any files created. Do not label every `SIGKILL` as a proxy failure.
