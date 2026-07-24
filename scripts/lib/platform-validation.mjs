const shebangPattern = /^#![^\r\n]+/u;

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
