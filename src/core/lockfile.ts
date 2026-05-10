import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { getLockfilePath } from '../utils/paths.js';

export interface SkillLockEntry {
  /** Normalized source identifier (e.g., "owner/repo", "./local-skills") */
  source: string;
  /** The provider/source type ("github" or "local") */
  sourceType: string;
  /** The original URL used to install (for re-fetching) */
  sourceUrl: string;
  /** Branch or tag ref used for installation */
  ref?: string;
  /** Subpath within the source repo */
  skillPath?: string;
  /** SHA-256 hash of the skill's file contents */
  hash: string;
  /** ISO timestamp when first installed (global only) */
  installedAt?: string;
  /** ISO timestamp when last updated (global only) */
  updatedAt?: string;
}

export interface SkillLockFile {
  version: number;
  skills: Record<string, SkillLockEntry>;
}

const CURRENT_VERSION = 1;

/**
 * Read the lockfile. Returns empty structure if not found or corrupted.
 */
export async function readLockfile(local: boolean, cwd?: string): Promise<SkillLockFile> {
  const lockPath = getLockfilePath(local, cwd);

  try {
    const content = await readFile(lockPath, 'utf-8');
    const parsed = JSON.parse(content) as SkillLockFile;

    if (typeof parsed.version !== 'number' || !parsed.skills) {
      return createEmptyLockfile();
    }

    if (parsed.version < CURRENT_VERSION) {
      return createEmptyLockfile();
    }

    return parsed;
  } catch {
    return createEmptyLockfile();
  }
}

/**
 * Write the lockfile. Skills are sorted alphabetically for clean diffs.
 */
export async function writeLockfile(lock: SkillLockFile, local: boolean, cwd?: string): Promise<void> {
  const lockPath = getLockfilePath(local, cwd);

  // Sort skills alphabetically for deterministic output
  const sortedSkills: Record<string, SkillLockEntry> = {};
  for (const key of Object.keys(lock.skills).sort()) {
    sortedSkills[key] = lock.skills[key]!;
  }

  const sorted: SkillLockFile = { version: lock.version, skills: sortedSkills };
  const content = JSON.stringify(sorted, null, 2) + '\n';

  // Ensure directory exists
  await mkdir(dirname(lockPath), { recursive: true });
  await writeFile(lockPath, content, 'utf-8');
}

/**
 * Add or update a skill entry in the lockfile.
 */
export async function addSkillToLockfile(
  skillName: string,
  entry: SkillLockEntry,
  local: boolean,
  cwd?: string
): Promise<void> {
  const lock = await readLockfile(local, cwd);
  const now = new Date().toISOString();

  const existing = lock.skills[skillName];

  lock.skills[skillName] = {
    ...entry,
    // For global lockfile, track timestamps
    installedAt: local ? undefined : (existing?.installedAt ?? now),
    updatedAt: local ? undefined : now,
  };

  await writeLockfile(lock, local, cwd);
}

/**
 * Remove a skill from the lockfile.
 */
export async function removeSkillFromLockfile(
  skillName: string,
  local: boolean,
  cwd?: string
): Promise<boolean> {
  const lock = await readLockfile(local, cwd);

  if (!(skillName in lock.skills)) {
    return false;
  }

  delete lock.skills[skillName];
  await writeLockfile(lock, local, cwd);
  return true;
}

/**
 * Get a skill entry from the lockfile.
 */
export async function getSkillFromLockfile(
  skillName: string,
  local: boolean,
  cwd?: string
): Promise<SkillLockEntry | null> {
  const lock = await readLockfile(local, cwd);
  return lock.skills[skillName] ?? null;
}

function createEmptyLockfile(): SkillLockFile {
  return {
    version: CURRENT_VERSION,
    skills: {},
  };
}
