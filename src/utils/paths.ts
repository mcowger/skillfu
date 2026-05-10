import { join, normalize, resolve, sep, basename } from 'path';
import { homedir } from 'os';

/**
 * Get the skillfu config directory.
 * Respects XDG_CONFIG_HOME and SKILLFU_CONFIG_DIR overrides.
 */
export function getConfigDir(): string {
  if (process.env.SKILLFU_CONFIG_DIR) {
    return process.env.SKILLFU_CONFIG_DIR;
  }
  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  const configBase = xdgConfigHome || join(homedir(), '.config');
  return join(configBase, 'skillfu');
}

/**
 * Get the canonical skill storage directory.
 * Global: ~/.config/skillfu/skills/
 * Local: <cwd>/.agents/skills/
 */
export function getCanonicalSkillsDir(local: boolean, cwd?: string): string {
  if (local) {
    return join(cwd || process.cwd(), '.agents', 'skills');
  }
  return join(getConfigDir(), 'skills');
}

/**
 * Get the global lockfile path.
 * Global: ~/.config/skillfu/skills.lock
 * Local: <cwd>/.agents/skills.lock
 */
export function getLockfilePath(local: boolean, cwd?: string): string {
  if (local) {
    return join(cwd || process.cwd(), '.agents', 'skills.lock');
  }
  return join(getConfigDir(), 'skills.lock');
}

/**
 * Get the symlink target directory (where agents look for skills).
 * Global: ~/.agents/skills/
 * Local: <cwd>/.agents/skills/ (same as canonical — no symlink needed)
 */
export function getSymlinkDir(local: boolean, cwd?: string): string {
  if (local) {
    return join(cwd || process.cwd(), '.agents', 'skills');
  }
  return join(homedir(), '.agents', 'skills');
}

/**
 * Sanitize a skill name for use as a directory name.
 * Lowercase, replace non-alphanumeric with hyphens, strip leading/trailing dots/hyphens.
 * Max 255 chars. Prevents path traversal.
 */
export function sanitizeName(name: string): string {
  const sanitized = name
    .toLowerCase()
    .replace(/[^a-z0-9._]+/g, '-')
    .replace(/^[.\-]+|[.\-]+$/g, '');
  return sanitized.substring(0, 255) || 'unnamed-skill';
}

/**
 * Validate that a resolved path is within the expected base directory.
 * Prevents path traversal attacks.
 */
export function isPathSafe(basePath: string, targetPath: string): boolean {
  const normalizedBase = normalize(resolve(basePath));
  const normalizedTarget = normalize(resolve(targetPath));
  return normalizedTarget.startsWith(normalizedBase + sep) || normalizedTarget === normalizedBase;
}

/**
 * Shorten a path for display: replace homedir with ~ and cwd with .
 */
export function shortenPath(fullPath: string, cwd: string): string {
  const home = homedir();
  if (fullPath === home || fullPath.startsWith(home + sep)) {
    return '~' + fullPath.slice(home.length);
  }
  if (fullPath === cwd || fullPath.startsWith(cwd + sep)) {
    return '.' + fullPath.slice(cwd.length);
  }
  return fullPath;
}
