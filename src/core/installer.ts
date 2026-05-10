import { mkdir, rm, lstat, readlink, stat, writeFile } from 'fs/promises';
import { join, dirname, basename, normalize, resolve, sep, relative } from 'path';
import { platform } from 'os';
import { sanitizeName, isPathSafe, getCanonicalSkillsDir, getSymlinkDir, getConfigDir } from '../utils/paths.js';
import { copyDirectory, ensureDir, removeDir, createSymlink, removeSymlink, isDirectory } from '../utils/fs.js';
import { computeSkillHash } from '../core/hash.js';
import type { Skill } from '../core/skill-discovery.js';

export interface InstallResult {
  success: boolean;
  canonicalPath: string;
  symlinkPath?: string;
  mode: 'direct' | 'symlink';
  error?: string;
}

/**
 * Install a skill for global scope:
 * - Copy skill files to ~/.config/skillfu/skills/<skill-name>/
 * - Create symlink from ~/.agents/skills/<skill-name> → canonical location
 */
export async function installSkillGlobal(skill: Skill): Promise<InstallResult> {
  const skillName = sanitizeName(skill.name);
  const canonicalBase = getCanonicalSkillsDir(false); // global = false means get the config dir
  // Actually for global, canonical is in ~/.config/skillfu/skills/
  const configDir = getConfigSkillsDir();
  const canonicalDir = join(configDir, skillName);
  const symlinkBase = getSymlinkDir(false); // ~/.agents/skills/
  const symlinkPath = join(symlinkBase, skillName);

  // Validate paths
  if (!isPathSafe(configDir, canonicalDir)) {
    return {
      success: false,
      canonicalPath: canonicalDir,
      mode: 'symlink',
      error: 'Invalid skill name: potential path traversal detected',
    };
  }

  try {
    // Copy skill files to canonical location
    await ensureDir(canonicalDir);
    await rm(canonicalDir, { recursive: true, force: true });
    await copyDirectory(skill.path, canonicalDir);

    // Create symlink
    const symlinkCreated = await createSymlink(canonicalDir, symlinkPath);

    if (!symlinkCreated) {
      return {
        success: false,
        canonicalPath: canonicalDir,
        symlinkPath,
        mode: 'symlink',
        error: `Failed to create symlink at ${symlinkPath}. On Windows, enable Developer Mode for symlink support.`,
      };
    }

    return {
      success: true,
      canonicalPath: canonicalDir,
      symlinkPath,
      mode: 'symlink',
    };
  } catch (error) {
    return {
      success: false,
      canonicalPath: canonicalDir,
      mode: 'symlink',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Install a skill for local scope:
 * - Copy skill files directly to .agents/skills/<skill-name>/
 * - No symlink needed — files are where agents look
 */
export async function installSkillLocal(skill: Skill, cwd?: string): Promise<InstallResult> {
  const skillName = sanitizeName(skill.name);
  const canonicalDir = join(getCanonicalSkillsDir(true, cwd), skillName);

  if (!isPathSafe(getCanonicalSkillsDir(true, cwd), canonicalDir)) {
    return {
      success: false,
      canonicalPath: canonicalDir,
      mode: 'direct',
      error: 'Invalid skill name: potential path traversal detected',
    };
  }

  try {
    // Copy skill files directly to .agents/skills/<name>/
    await ensureDir(canonicalDir);
    await rm(canonicalDir, { recursive: true, force: true });
    await copyDirectory(skill.path, canonicalDir);

    return {
      success: true,
      canonicalPath: canonicalDir,
      mode: 'direct',
    };
  } catch (error) {
    return {
      success: false,
      canonicalPath: canonicalDir,
      mode: 'direct',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Install a skill from a BlobSkill (files already in memory) for global scope.
 */
export async function installBlobSkillGlobal(
  skill: { name: string; files: Array<{ path: string; contents: string }> }
): Promise<InstallResult> {
  const skillName = sanitizeName(skill.name);
  const configDir = getConfigSkillsDir();
  const canonicalDir = join(configDir, skillName);
  const symlinkBase = getSymlinkDir(false);
  const symlinkPath = join(symlinkBase, skillName);

  if (!isPathSafe(configDir, canonicalDir)) {
    return {
      success: false,
      canonicalPath: canonicalDir,
      mode: 'symlink',
      error: 'Invalid skill name: potential path traversal detected',
    };
  }

  try {
    await ensureDir(canonicalDir);
    await rm(canonicalDir, { recursive: true, force: true });
    await writeSkillFiles(canonicalDir, skill.files);

    const symlinkCreated = await createSymlink(canonicalDir, symlinkPath);
    if (!symlinkCreated) {
      return {
        success: false,
        canonicalPath: canonicalDir,
        symlinkPath,
        mode: 'symlink',
        error: `Failed to create symlink at ${symlinkPath}. On Windows, enable Developer Mode for symlink support.`,
      };
    }

    return {
      success: true,
      canonicalPath: canonicalDir,
      symlinkPath,
      mode: 'symlink',
    };
  } catch (error) {
    return {
      success: false,
      canonicalPath: canonicalDir,
      mode: 'symlink',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Install a skill from a BlobSkill for local scope.
 */
export async function installBlobSkillLocal(
  skill: { name: string; files: Array<{ path: string; contents: string }> },
  cwd?: string
): Promise<InstallResult> {
  const skillName = sanitizeName(skill.name);
  const canonicalDir = join(getCanonicalSkillsDir(true, cwd), skillName);

  if (!isPathSafe(getCanonicalSkillsDir(true, cwd), canonicalDir)) {
    return {
      success: false,
      canonicalPath: canonicalDir,
      mode: 'direct',
      error: 'Invalid skill name: potential path traversal detected',
    };
  }

  try {
    await ensureDir(canonicalDir);
    await rm(canonicalDir, { recursive: true, force: true });
    await writeSkillFiles(canonicalDir, skill.files);

    return {
      success: true,
      canonicalPath: canonicalDir,
      mode: 'direct',
    };
  } catch (error) {
    return {
      success: false,
      canonicalPath: canonicalDir,
      mode: 'direct',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Remove a globally installed skill (canonical files + symlink).
 */
export async function removeSkillGlobal(skillName: string): Promise<boolean> {
  const sanitized = sanitizeName(skillName);
  const configDir = getConfigSkillsDir();
  const canonicalDir = join(configDir, sanitized);
  const symlinkBase = getSymlinkDir(false);
  const symlinkPath = join(symlinkBase, sanitized);

  try {
    await removeSymlink(symlinkPath);
    await removeDir(canonicalDir);
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove a locally installed skill (just the canonical directory).
 */
export async function removeSkillLocal(skillName: string, cwd?: string): Promise<boolean> {
  const sanitized = sanitizeName(skillName);
  const canonicalDir = join(getCanonicalSkillsDir(true, cwd), sanitized);

  try {
    await removeDir(canonicalDir);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the canonical path for a skill.
 */
export function getCanonicalSkillPath(skillName: string, local: boolean, cwd?: string): string {
  const sanitized = sanitizeName(skillName);
  if (local) {
    return join(getCanonicalSkillsDir(true, cwd), sanitized);
  }
  return join(getConfigSkillsDir(), sanitized);
}

/**
 * Get the symlink path for a global skill.
 */
export function getSymlinkSkillPath(skillName: string): string {
  const sanitized = sanitizeName(skillName);
  return join(getSymlinkDir(false), sanitized);
}

/**
 * Get ~/.config/skillfu/skills/ (canonical global storage).
 */
function getConfigSkillsDir(): string {
  return join(getConfigDir(), 'skills');
}

/**
 * Write skill files to a directory.
 */
async function writeSkillFiles(
  targetDir: string,
  files: Array<{ path: string; contents: string }>
): Promise<void> {
  for (const file of files) {
    const fullPath = join(targetDir, file.path);
    if (!isPathSafe(targetDir, fullPath)) continue;

    const parentDir = dirname(fullPath);
    if (parentDir !== targetDir) {
      await ensureDir(parentDir);
    }

    await writeFile(fullPath, file.contents, 'utf-8');
  }
}
