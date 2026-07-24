const shebangPattern = /^#![^\r\n]+/u;
const frontmatterPattern = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u;

export const extractYamlFrontmatter = (content = "") =>
  content.match(frontmatterPattern)?.[1] ?? "";

export const validateExecutableMetadata = ({
  relative,
  platform = process.platform,
  mode = 0,
  content = "",
}) => {
  const errors = [];
  if (!shebangPattern.test(content)) {
    errors.push(`Executable script is missing a shebang: ${relative}`);
  }
  if (platform !== "win32" && (mode & 0o111) === 0) {
    errors.push(`Executable file is missing execute permission: ${relative}`);
  }
  return errors;
};
