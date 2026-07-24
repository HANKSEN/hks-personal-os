import assert from "node:assert/strict";
import test from "node:test";

import {
  extractYamlFrontmatter,
  validateExecutableMetadata,
} from "../scripts/lib/platform-validation.mjs";

test("extracts skill frontmatter from LF and CRLF checkouts", () => {
  const expected = "name: personal-os\ndescription: Test";
  assert.equal(
    extractYamlFrontmatter(`---\n${expected}\n---\n\n# Skill\n`),
    expected,
  );
  assert.equal(
    extractYamlFrontmatter("---\r\nname: personal-os\r\ndescription: Test\r\n---\r\n\r\n# Skill\r\n"),
    "name: personal-os\r\ndescription: Test",
  );
});

test("Windows validates script identity without requiring POSIX execute bits", () => {
  const errors = validateExecutableMetadata({
    relative: "scripts/pos.mjs",
    platform: "win32",
    mode: 0o100666,
    content: "#!/usr/bin/env node\n",
  });
  assert.deepEqual(errors, []);
});

test("POSIX platforms continue to require execute bits", () => {
  const errors = validateExecutableMetadata({
    relative: "scripts/pos.mjs",
    platform: "linux",
    mode: 0o100644,
    content: "#!/usr/bin/env node\n",
  });
  assert.deepEqual(errors, [
    "Executable file is missing execute permission: scripts/pos.mjs",
  ]);
});

test("all platforms require an executable script shebang", () => {
  const errors = validateExecutableMetadata({
    relative: "scripts/pos.mjs",
    platform: "win32",
    mode: 0o100666,
    content: "process.stdout.write('missing shebang');\n",
  });
  assert.deepEqual(errors, [
    "Executable script is missing a shebang: scripts/pos.mjs",
  ]);
});
