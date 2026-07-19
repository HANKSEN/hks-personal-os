import { createHash } from "node:crypto";
import { lstat, readdir } from "node:fs/promises";
import path from "node:path";

import { invariant } from "./errors.mjs";
import { readJson, sha256File } from "./io.mjs";

export const PACKAGE_MANIFEST_SCHEMA = "personal-os.package-manifest.v1";
export const INSTALL_MARKER_V1 = "personal-os.install.v1";
export const INSTALL_MARKER_V2 = "personal-os.install.v2";
export const MANIFEST_FILE = ".personal-os-manifest.json";
export const MARKER_FILE = ".personal-os-install.json";

const CONTROL_FILES = new Set([MANIFEST_FILE, MARKER_FILE]);

function normalizePackageRelative(relative) {
  const normalized = String(relative).replaceAll("\\", "/").replace(/^\.\//u, "");
  invariant(normalized && normalized !== "." && !normalized.startsWith("../") && !path.posix.isAbsolute(normalized), "INVALID_PACKAGE_PATH", "Package manifest path must remain relative to the package root.", { path: relative }, 3);
  return normalized;
}

function digestPayload(manifest) {
  return {
    schema: PACKAGE_MANIFEST_SCHEMA,
    package: manifest.package,
    version: manifest.version,
    files: manifest.files.map(({ path: relative, size, sha256 }) => ({ path: relative, size, sha256 })),
  };
}

export function packageManifestDigest(manifest) {
  return createHash("sha256").update(JSON.stringify(digestPayload(manifest))).digest("hex");
}

async function collectEntry(root, absolute, relative, output) {
  const info = await lstat(absolute);
  invariant(!info.isSymbolicLink(), "PACKAGE_SYMLINK_REJECTED", "Runtime packages may not contain symbolic links.", { path: relative }, 3);
  if (info.isDirectory()) {
    const entries = await readdir(absolute, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      await collectEntry(root, path.join(absolute, entry.name), child, output);
    }
    return;
  }
  invariant(info.isFile(), "PACKAGE_FILE_TYPE_REJECTED", "Runtime packages may contain only regular files and directories.", { path: relative }, 3);
  const normalized = normalizePackageRelative(relative);
  if (CONTROL_FILES.has(normalized)) return;
  output.set(normalized, { path: normalized, size: info.size, sha256: await sha256File(absolute) });
}

export async function buildPackageManifest(rootInput, { packageName, version, entries = null } = {}) {
  const root = path.resolve(rootInput);
  const files = new Map();
  if (entries) {
    for (const entry of [...new Set(entries.map(normalizePackageRelative))]) {
      const absolute = path.resolve(root, ...entry.split("/"));
      invariant(absolute.startsWith(`${root}${path.sep}`), "INVALID_PACKAGE_PATH", "Package entry escapes the package root.", { entry }, 3);
      await collectEntry(root, absolute, entry, files);
    }
  } else {
    const children = await readdir(root, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const child of children) await collectEntry(root, path.join(root, child.name), child.name, files);
  }
  const manifest = {
    schema: PACKAGE_MANIFEST_SCHEMA,
    package: packageName,
    version,
    files: [...files.values()].sort((left, right) => left.path.localeCompare(right.path, "en")),
  };
  return { ...manifest, digest: packageManifestDigest(manifest) };
}

export async function readInstallMarker(versionDir) {
  const marker = await readJson(path.join(versionDir, MARKER_FILE));
  invariant([INSTALL_MARKER_V1, INSTALL_MARKER_V2].includes(marker?.schema), "INVALID_INSTALL_MARKER", "Unsupported Personal OS installation marker.", { path: versionDir, schema: marker?.schema }, 3);
  invariant(typeof marker.package === "string" && typeof marker.version === "string", "INVALID_INSTALL_MARKER", "Personal OS installation marker is incomplete.", { path: versionDir }, 3);
  return marker;
}

export async function verifyInstalledPackage(versionDir, { packageName, version, allowLegacy = true } = {}) {
  const marker = await readInstallMarker(versionDir);
  invariant(!packageName || marker.package === packageName, "INSTALL_PACKAGE_MISMATCH", "Installed package name does not match Personal OS.", { expected: packageName, actual: marker.package }, 3);
  invariant(!version || marker.version === version, "INSTALL_VERSION_MISMATCH", "Installed package marker does not match the requested version.", { expected: version, actual: marker.version }, 3);
  if (marker.schema === INSTALL_MARKER_V1) {
    invariant(allowLegacy, "LEGACY_INSTALL_UNVERIFIED", "Legacy Personal OS installation has no content manifest.", { version: marker.version, path: versionDir }, 3);
    for (const relative of ["SKILL.md", "scripts/pos.mjs", "scripts/install.mjs"]) {
      const info = await lstat(path.join(versionDir, relative)).catch(() => null);
      invariant(info?.isFile() && !info.isSymbolicLink(), "LEGACY_INSTALL_INCOMPLETE", "Legacy installation is missing a required runtime file.", { version: marker.version, path: relative }, 3);
    }
    return { status: "legacy-unverified", marker, manifest: null };
  }

  const manifest = await readJson(path.join(versionDir, MANIFEST_FILE));
  invariant(manifest?.schema === PACKAGE_MANIFEST_SCHEMA, "INVALID_PACKAGE_MANIFEST", "Installed package manifest schema is invalid.", { path: versionDir, schema: manifest?.schema }, 3);
  invariant(manifest.package === marker.package && manifest.version === marker.version, "INVALID_PACKAGE_MANIFEST", "Installed package manifest identity does not match its marker.", { path: versionDir }, 3);
  const digest = packageManifestDigest(manifest);
  invariant(digest === manifest.digest && digest === marker.packageDigest, "INSTALL_INTEGRITY_MISMATCH", "Installed package manifest digest does not match its marker.", { path: versionDir, expected: marker.packageDigest, actual: digest }, 4);
  const actual = await buildPackageManifest(versionDir, { packageName: marker.package, version: marker.version });
  invariant(actual.digest === manifest.digest, "INSTALL_INTEGRITY_MISMATCH", "Installed package files differ from the verified manifest.", { path: versionDir, expected: manifest.digest, actual: actual.digest }, 4);
  return { status: "verified", marker, manifest };
}

export async function compareLegacyToSource(versionDir, sourceManifest) {
  const actual = await buildPackageManifest(versionDir, { packageName: sourceManifest.package, version: sourceManifest.version });
  return { matches: actual.digest === sourceManifest.digest, actual, expected: sourceManifest };
}
