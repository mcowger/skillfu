import { readdir, readFile, stat } from 'fs/promises';
import { join, dirname, basename } from 'path';
import { parseFrontmatter } from './frontmatter.js';

export interface Skill {
  name: string;
  description: string;
  path: string;
  rawContent?: string;
  metadata?: Record<string, unknown>;
}

export interface DiscoverSkillsOptions {
  includeInternal?: boolean;
  fullDepth?: boolean;
}

const SKIP_DIRS = ['node_modules', '.git', 'dist', 'build', '__pycache__'];

/**
 * Check if internal skills should be installed.
 */
export function shouldInstallInternalSkills(): boolean {
  const envValue = process.env.INSTALL_INTERNAL_SKILLS;
  return envValue === '1' || envValue === 'true';
}

/**
 * Parse a SKILL.md file and return a Skill object.
 * Returns null if the file is invalid or missing required fields.
 */
export async function parseSkillMd(
  skillMdPath: string,
  options?: { includeInternal?: boolean }
): Promise<Skill | null> {
  try {
    const content = await readFile(skillMdPath, 'utf-8');
    const data = await parseFrontmatter(skillMdPath);

    if (!data) return null;
    if (!data.name || !data.description) return null;

    if (typeof data.name !== 'string' || typeof data.description !== 'string') return null;

    // Skip internal skills unless explicitly requested
    const isInternal = data.metadata?.internal === true;
    if (isInternal && !shouldInstallInternalSkills() && !options?.includeInternal) {
      return null;
    }

    return {
      name: String(data.name),
      description: String(data.description),
      path: dirname(skillMdPath),
      rawContent: content,
      metadata: data.metadata as Record<string, unknown> | undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Check if a directory contains a SKILL.md file.
 */
async function hasSkillMd(dir: string): Promise<boolean> {
  try {
    const skillPath = join(dir, 'SKILL.md');
    const stats = await stat(skillPath);
    return stats.isFile();
  } catch {
    return false;
  }
}

/**
 * Recursively find all directories containing SKILL.md files.
 */
async function findSkillDirs(dir: string, depth = 0, maxDepth = 5): Promise<string[]> {
  if (depth > maxDepth) return [];

  try {
    const [hasSkill, entries] = await Promise.all([
      hasSkillMd(dir),
      readdir(dir, { withFileTypes: true }).catch(() => []),
    ]);

    const currentDir = hasSkill ? [dir] : [];

    const subDirResults = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !SKIP_DIRS.includes(entry.name))
        .map((entry) => findSkillDirs(join(dir, entry.name), depth + 1, maxDepth))
    );

    return [...currentDir, ...subDirResults.flat()];
  } catch {
    return [];
  }
}

/**
 * Discover skills in a directory.
 * Searches standard skill locations first, then falls back to recursive search.
 */
export async function discoverSkills(
  basePath: string,
  subpath?: string,
  options?: DiscoverSkillsOptions
): Promise<Skill[]> {
  const skills: Skill[] = [];
  const seenNames = new Set<string>();

  const searchPath = subpath ? join(basePath, subpath) : basePath;

  // If pointing directly at a skill, add it
  if (await hasSkillMd(searchPath)) {
    const skill = await parseSkillMd(join(searchPath, 'SKILL.md'), options);
    if (skill) {
      skills.push(skill);
      seenNames.add(skill.name);
      if (!options?.fullDepth) {
        return skills;
      }
    }
  }

  // Search common skill locations first
  const prioritySearchDirs = [
    searchPath,
    join(searchPath, 'skills'),
    join(searchPath, 'skills', '.curated'),
    join(searchPath, 'skills', '.experimental'),
    join(searchPath, '.agents', 'skills'),
    join(searchPath, '.claude', 'skills'),
  ];

  for (const dir of prioritySearchDirs) {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillDir = join(dir, entry.name);
          if (await hasSkillMd(skillDir)) {
            const skill = await parseSkillMd(join(skillDir, 'SKILL.md'), options);
            if (skill && !seenNames.has(skill.name)) {
              skills.push(skill);
              seenNames.add(skill.name);
            }
          }
        }
      }
    } catch {
      // Directory doesn't exist
    }
  }

  // Fall back to recursive search if nothing found, or if fullDepth is set
  if (skills.length === 0 || options?.fullDepth) {
    const allSkillDirs = await findSkillDirs(searchPath);
    for (const skillDir of allSkillDirs) {
      const skill = await parseSkillMd(join(skillDir, 'SKILL.md'), options);
      if (skill && !seenNames.has(skill.name)) {
        skills.push(skill);
        seenNames.add(skill.name);
      }
    }
  }

  return skills;
}

/**
 * Get the display name for a skill (uses name field, falls back to directory name).
 */
export function getSkillDisplayName(skill: Skill): string {
  return skill.name || basename(skill.path);
}

/**
 * Filter skills based on user-provided names (case-insensitive).
 */
export function filterSkills(skills: Skill[], inputNames: string[]): Skill[] {
  const normalizedInputs = inputNames.map((n) => n.toLowerCase());
  return skills.filter((skill) => {
    const name = skill.name.toLowerCase();
    const displayName = getSkillDisplayName(skill).toLowerCase();
    return normalizedInputs.some((input) => input === name || input === displayName);
  });
}
