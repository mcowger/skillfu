import { mkdir, rm, symlink, lstat, readlink, readdir, stat, writeFile, cp } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname, basename, relative, resolve, normalize, sep } from 'path';
import { platform } from 'os';
import { isPathSafe, sanitizeName } from './paths.js';

const EXCLUDE_DIRS = new Set(['.git', 'node_modules', '__pycache__', '__pypackages__', 'dist', 'build']);
const EXCLUDE_FILES = new Set(['metadata.json']);

/**
 * Create a directory recursively if it doesn't exist.
 */
export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

/**
 * Remove a directory recursively.
 */
export async function removeDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

/**
 * Copy a directory recursively, excluding .git and node_modules.
 */
export async function copyDirectory(src: string, dest: string): Promise<void> {
  await ensureDir(dest);
  const entries = await readdir(src, { withFileTypes: true });

  await Promise.all(
    entries
      .filter((entry) => {
        if (EXCLUDE_DIRS.has(entry.name) && entry.isDirectory()) return false;
        if (EXCLUDE_FILES.has(entry.name) && !entry.isDirectory()) return false;
        return true;
      })
      .map(async (entry) => {
        const srcPath = join(src, entry.name);
        const destPath = join(dest, entry.name);
        if (entry.isDirectory()) {
          await copyDirectory(srcPath, destPath);
        } else {
          // Use Bun's cp which handles symlinks properly
          await cp(srcPath, destPath, {
            dereference: true,
            recursive: true,
          } as any).catch(async (err: any) => {
            // Skip broken symlinks
            if (err?.code === 'ENOENT' && entry.isSymbolicLink()) {
              // skip
            } else {
              throw err;
            }
          });
        }
      })
  );
}

/**
 * Create a symlink, handling cross-platform differences.
 * Returns true if symlink was created or already exists with the correct target.
 */
export async function createSymlink(target: string, linkPath: string): Promise<boolean> {
  try {
    const resolvedTarget = resolve(target);
    const resolvedLinkPath = resolve(linkPath);

    // If they resolve to the same path, nothing to do
    if (resolvedTarget === resolvedLinkPath) {
      return true;
    }

    // Check if symlink already exists with correct target
    try {
      const linkStat = await lstat(linkPath);
      if (linkStat.isSymbolicLink()) {
        const existingTarget = await readlink(linkPath);
        const resolvedExisting = resolve(dirname(linkPath), existingTarget);
        if (resolvedExisting === resolvedTarget) {
          return true; // Already correct
        }
        // Wrong target — remove and recreate
        await rm(linkPath, { force: true });
      } else {
        // Not a symlink — remove the directory/file
        await rm(linkPath, { recursive: true, force: true });
      }
    } catch {
      // Doesn't exist — good, we'll create it
    }

    // Ensure parent directory exists
    await ensureDir(dirname(linkPath));

    // Create relative symlink for portability
    const linkDir = dirname(linkPath);
    const relativeTarget = relative(linkDir, target);
    const symlinkType = platform() === 'win32' ? 'junction' : undefined;

    await symlink(relativeTarget, linkPath, symlinkType);
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove a symlink if it exists. Does not remove the canonical files.
 */
export async function removeSymlink(linkPath: string): Promise<void> {
  try {
    const linkStat = await lstat(linkPath);
    if (linkStat) {
      await rm(linkPath, { recursive: true, force: true });
    }
  } catch {
    // Doesn't exist — nothing to do
  }
}

/**
 * Check if a path is a symlink.
 */
export async function isSymlink(path: string): Promise<boolean> {
  try {
    const s = await lstat(path);
    return s.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Check if a directory exists and is a directory.
 */
export async function isDirectory(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

/**
 * List immediate subdirectories of a directory.
 */
export async function listSubdirectories(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const dirs: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        dirs.push(entry.name);
      }
    }
    return dirs;
  } catch {
    return [];
  }
}
