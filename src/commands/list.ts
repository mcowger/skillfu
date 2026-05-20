import * as p from '@clack/prompts';
import pc from 'picocolors';
import { readLockfile, type SkillLockEntry } from '../core/lockfile.js';
import { getCanonicalSkillPath, getSymlinkSkillPath } from '../core/installer.js';
import { shortenPath, getBaseDir } from '../utils/paths.js';
import { existsSync } from 'fs';
import { lstatSync } from 'fs';

export interface ListOptions {
  local?: boolean;
  target?: string;
}

export async function runList(options: ListOptions = {}): Promise<void> {
  const cwd = getBaseDir(options.target);
  const isLocal = options.local || !!options.target;

  console.log();
  p.intro(pc.bgCyan(pc.black(' skillfu ')));

  const lock = await readLockfile(isLocal, cwd);
  const entries = Object.entries(lock.skills);

  if (entries.length === 0) {
    p.outro(pc.yellow('No skills found in lockfile. Add skills with `skillfu add <source>`.'));
    return;
  }

  const scope = isLocal ? 'local' : 'global';
  p.log.info(`${pc.cyan(String(entries.length))} skill${entries.length !== 1 ? 's' : ''} registered in ${scope} lockfile`);

  console.log();

  // Table-style display
  for (const [name, entry] of entries) {
    const installed = isSkillOnDisk(name, isLocal, cwd);
    const status = installed ? pc.green('✓') : pc.yellow('✗');
    const sourceLabel = formatSource(entry);

    console.log(`  ${status} ${pc.bold(pc.cyan(name))}  ${pc.dim('from')} ${sourceLabel}`);

    // Show additional details
    const details: string[] = [];
    if (entry.ref) {
      details.push(`${pc.dim('ref:')} ${pc.yellow(entry.ref)}`);
    }
    if (entry.skillPath) {
      details.push(`${pc.dim('path:')} ${pc.dim(entry.skillPath)}`);
    }

    // Show install location
    const canonicalPath = getCanonicalSkillPath(name, isLocal, cwd);
    details.push(`${pc.dim('at:')} ${pc.dim(shortenPath(canonicalPath, cwd))}`);

    if (details.length > 0) {
      console.log(`      ${details.join('  ')}`);
    }

    // Show symlink for global skills
    if (!isLocal && installed) {
      const symlinkPath = getSymlinkSkillPath(name);
      try {
        const stat = lstatSync(symlinkPath);
        if (stat.isSymbolicLink()) {
          // Symlink exists — no extra info needed, the path is enough
        } else {
          console.log(`      ${pc.yellow('⚠ symlink missing')}`);
        }
      } catch {
        console.log(`      ${pc.yellow('⚠ symlink missing')}`);
      }
    }

    if (entry.updatedAt) {
      const date = new Date(entry.updatedAt);
      const relative = formatRelativeDate(date);
      console.log(`      ${pc.dim('updated:')} ${pc.dim(relative)}`);
    }
  }

  // Summary counts
  const installedCount = entries.filter(([name]) => isSkillOnDisk(name, isLocal, cwd)).length;
  const missingCount = entries.length - installedCount;

  console.log();
  if (missingCount > 0) {
    p.log.warn(pc.yellow(`${missingCount} skill(s) registered but not found on disk. Run ${pc.cyan('skillfu install')} to restore.`));
  } else {
    p.log.info(pc.dim(`All ${entries.length} skill(s) installed on disk.`));
  }

  console.log();
  p.outro(pc.green('Done!'));
}

/**
 * Check if a skill's canonical directory exists on disk.
 */
function isSkillOnDisk(name: string, local: boolean, cwd: string): boolean {
  const canonicalPath = getCanonicalSkillPath(name, local, cwd);
  return existsSync(canonicalPath);
}

/**
 * Format the source for display.
 */
function formatSource(entry: SkillLockEntry): string {
  if (entry.sourceType === 'local') {
    return pc.magenta(entry.source);
  }
  return pc.blue(entry.source);
}

/**
 * Format a date as a relative time string (e.g., "2 days ago").
 */
function formatRelativeDate(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (years > 0) return `${years} year${years !== 1 ? 's' : ''} ago`;
  if (months > 0) return `${months} month${months !== 1 ? 's' : ''} ago`;
  if (weeks > 0) return `${weeks} week${weeks !== 1 ? 's' : ''} ago`;
  if (days > 0) return `${days} day${days !== 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
  return 'just now';
}
