import * as p from '@clack/prompts';
import pc from 'picocolors';
import { readdir, stat, lstat, readlink } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { readLockfile, addSkillToLockfile, type SkillLockEntry } from '../core/lockfile.js';
import { parseSource, type ParsedSource } from '../core/source-parser.js';
import { discoverSkills, filterSkills, getSkillDisplayName } from '../core/skill-discovery.js';
import { installSkillGlobal, installSkillLocal, getCanonicalSkillPath, getSymlinkSkillPath } from '../core/installer.js';
import { computeSkillHash } from '../core/hash.js';
import { cloneRepo, cleanupTempDir } from '../providers/github.js';
import { sanitizeName, shortenPath, getCanonicalSkillsDir, getSymlinkDir } from '../utils/paths.js';
import { listSubdirectories, isDirectory, removeDir, removeSymlink } from '../utils/fs.js';
import type { Skill } from '../core/skill-discovery.js';

export interface InstallOptions {
  local?: boolean;
}

/**
 * Install all skills from the lockfile. Idempotent.
 * Like `npm ci` — makes the filesystem match the lockfile.
 */
export async function runInstall(options: InstallOptions = {}): Promise<void> {
  const cwd = process.cwd();
  const isLocal = options.local ?? false;

  console.log();
  p.intro(pc.bgCyan(pc.black(' skillfu ')));

  const lock = await readLockfile(isLocal, cwd);
  const lockEntries = Object.entries(lock.skills);

  if (lockEntries.length === 0) {
    p.outro(pc.yellow('No skills found in lockfile. Add skills with `skillfu add <source>`.'));
    return;
  }

  p.log.info(
    `Restoring ${pc.cyan(String(lockEntries.length))} skill${lockEntries.length !== 1 ? 's' : ''} from lockfile`
  );

  const spinner = p.spinner();
  spinner.start('Checking installed skills...');

  let installedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  // Group skills by source for efficient cloning
  const bySource = new Map<string, { parsed: ParsedSource; skills: Array<{ name: string; entry: SkillLockEntry }> }>();

  for (const [skillName, entry] of lockEntries) {
    // Check if already installed and matching
    const canonicalPath = getCanonicalSkillPath(skillName, isLocal, cwd);
    const alreadyInstalled = await isSkillInstalled(skillName, isLocal, cwd);

    if (alreadyInstalled && !isLocal) {
      // For global, also check symlink
      const symlinkPath = getSymlinkSkillPath(skillName);
      const symlinkExists = await isDirectory(symlinkPath).then(() => true).catch(() => false) ||
        existsSync(symlinkPath);
      if (symlinkExists) {
        // Verify hash matches
        try {
          const currentHash = await computeSkillHash(canonicalPath);
          if (currentHash === entry.hash) {
            skippedCount++;
            continue;
          }
        } catch {
          // Can't compute hash — re-install
        }
      }
    } else if (alreadyInstalled && isLocal) {
      try {
        const currentHash = await computeSkillHash(canonicalPath);
        if (currentHash === entry.hash) {
          skippedCount++;
          continue;
        }
      } catch {
        // Can't compute hash — re-install
      }
    }

    // Need to install — group by source
    if (entry.sourceType === 'local') {
      // Local skills: just verify they exist
      if (existsSync(entry.sourceUrl)) {
        // Re-install from local source
        try {
          const skills = await discoverSkills(entry.sourceUrl, undefined, { includeInternal: true });
          const matchingSkill = filterSkills(skills, [skillName]);

          if (matchingSkill.length > 0) {
            const result = isLocal
              ? await installSkillLocal(matchingSkill[0]!, cwd)
              : await installSkillGlobal(matchingSkill[0]!);

            if (result.success) {
              installedCount++;
            } else {
              failedCount++;
              p.log.warn(`Failed to install ${skillName}: ${result.error}`);
            }
          } else {
            failedCount++;
            p.log.warn(`Skill "${skillName}" not found at local source: ${entry.sourceUrl}`);
          }
        } catch (err) {
          failedCount++;
          p.log.warn(`Failed to install ${skillName}: ${err instanceof Error ? err.message : String(err)}`);
        }
      } else {
        failedCount++;
        p.log.warn(`Local source not found for ${skillName}: ${entry.sourceUrl}`);
      }
      continue;
    }

    // GitHub source — group by source for batch processing
    try {
      const parsed = parseSource(entry.sourceUrl || entry.source);
      const key = `${parsed.url}#${entry.ref || ''}`;
      const existing = bySource.get(key);
      if (existing) {
        existing.skills.push({ name: skillName, entry });
      } else {
        bySource.set(key, { parsed, skills: [{ name: skillName, entry }] });
      }
    } catch (err) {
      failedCount++;
      p.log.warn(`Invalid source for ${skillName}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Install from each GitHub source
  for (const [, { parsed, skills: sourceSkills }] of bySource) {
    let tempDir: string | null = null;

    try {
      spinner.start(`Cloning ${pc.cyan(parsed.ownerRepo || parsed.url)}...`);

      if (parsed.type === 'local') {
        const localSkills = await discoverSkills(parsed.localPath!, parsed.subpath, { includeInternal: true });
        for (const { name: skillName, entry } of sourceSkills) {
          const matching = filterSkills(localSkills, [skillName]);
          if (matching.length > 0) {
            const result = isLocal
              ? await installSkillLocal(matching[0]!, cwd)
              : await installSkillGlobal(matching[0]!);
            if (result.success) {
              installedCount++;
            } else {
              failedCount++;
              p.log.warn(`Failed to install ${skillName}: ${result.error}`);
            }
          } else {
            failedCount++;
            p.log.warn(`Skill "${skillName}" not found in source`);
          }
        }
        continue;
      }

      tempDir = await cloneRepo(parsed.url, parsed.ref);
      spinner.stop('Repository cloned');

      const allSkills = await discoverSkills(tempDir, parsed.subpath, { includeInternal: true });

      for (const { name: skillName, entry } of sourceSkills) {
        const matching = filterSkills(allSkills, [skillName]);
        if (matching.length > 0) {
          const result = isLocal
            ? await installSkillLocal(matching[0]!, cwd)
            : await installSkillGlobal(matching[0]!);

          if (result.success) {
            installedCount++;
          } else {
            failedCount++;
            p.log.warn(`Failed to install ${skillName}: ${result.error}`);
          }
        } else {
          failedCount++;
          p.log.warn(`Skill "${skillName}" not found in source`);
        }
      }
    } catch (err) {
      failedCount += sourceSkills.length;
      p.log.error(
        `Failed to clone ${parsed.ownerRepo || parsed.url}: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      if (tempDir) {
        try {
          await cleanupTempDir(tempDir);
        } catch {}
      }
    }
  }

  spinner.stop('Install check complete');

  // Orphan detection: remove skills on disk that aren't in the lockfile
  const lockSkillNames = new Set(Object.keys(lock.skills));
  const skillsDir = getCanonicalSkillsDir(isLocal, cwd);
  const diskSkills = await listSubdirectories(skillsDir);

  const orphans = diskSkills.filter((name) => !lockSkillNames.has(name));
  if (orphans.length > 0) {
    p.log.warn(pc.yellow(`Found ${orphans.length} orphaned skill(s) not in lockfile:`));
    for (const orphan of orphans) {
      p.log.message(`  ${pc.yellow('•')} ${orphan}`);
    }

    // Remove orphans
    for (const orphan of orphans) {
      const orphanPath = join(skillsDir, orphan);
      await removeDir(orphanPath);

      // For global, also remove the symlink
      if (!isLocal) {
        const symlinkPath = getSymlinkSkillPath(orphan);
        await removeSymlink(symlinkPath);
      }
    }
    p.log.info(pc.dim(`Removed ${orphans.length} orphaned skill(s)`));
  }

  console.log();
  if (installedCount > 0) {
    p.log.success(pc.green(`Installed ${installedCount} skill(s)`));
  }
  if (skippedCount > 0) {
    p.log.info(pc.dim(`${skippedCount} skill(s) already up to date`));
  }
  if (failedCount > 0) {
    p.log.error(pc.red(`Failed to install ${failedCount} skill(s)`));
  }
  if (orphans.length > 0) {
    p.log.info(pc.yellow(`Removed ${orphans.length} orphaned skill(s)`));
  }

  console.log();
  p.outro(pc.green('Done!'));
}

/**
 * Check if a skill is already installed on disk.
 */
async function isSkillInstalled(
  skillName: string,
  local: boolean,
  cwd: string
): Promise<boolean> {
  const canonicalPath = getCanonicalSkillPath(skillName, local, cwd);
  return existsSync(canonicalPath);
}
