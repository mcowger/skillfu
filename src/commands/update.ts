import * as p from '@clack/prompts';
import pc from 'picocolors';
import { relative } from 'path';
import { readLockfile, addSkillToLockfile, type SkillLockEntry } from '../core/lockfile.js';
import { parseSource } from '../core/source-parser.js';
import { discoverSkills, filterSkills, getSkillDisplayName } from '../core/skill-discovery.js';
import { installSkillGlobal, installSkillLocal, getCanonicalSkillPath, getSymlinkSkillPath } from '../core/installer.js';
import { computeSkillHash } from '../core/hash.js';
import { cloneRepo, cleanupTempDir, fetchSkillFolderHash } from '../providers/github.js';
import { getSkillHash, skillNameToSlug, buildSourceId } from '../providers/skills-sh.js';
import { sanitizeName, shortenPath, getBaseDir } from '../utils/paths.js';
import type { Skill } from '../core/skill-discovery.js';

export interface UpdateOptions {
  local?: boolean;
  skill?: string[];
  yes?: boolean;
  target?: string;
}

export async function runUpdate(options: UpdateOptions = {}): Promise<void> {
  const cwd = getBaseDir(options.target);
  const isLocal = options.local || !!options.target;

  console.log();
  p.intro(pc.bgCyan(pc.black(' skillfu ')));

  const lock = await readLockfile(isLocal, cwd);
  const lockEntries = Object.entries(lock.skills);

  if (lockEntries.length === 0) {
    p.outro(pc.yellow('No skills found in lockfile. Add skills with `skillfu add <source>`.'));
    return;
  }

  // Filter by --skill option if provided
  const filteredEntries = options.skill && options.skill.length > 0
    ? lockEntries.filter(([name]) =>
        options.skill!.some((s) => s.toLowerCase() === name.toLowerCase())
      )
    : lockEntries;

  if (filteredEntries.length === 0 && options.skill) {
    p.outro(pc.yellow(`No installed skills found matching: ${options.skill.join(', ')}`));
    return;
  }

  p.log.info(`Checking for updates...`);
  console.log();

  const spinner = p.spinner();
  let updatedCount = 0;
  let currentCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const [skillName, entry] of filteredEntries) {
    // Skip local skills — they can't be updated remotely
    if (entry.sourceType === 'local') {
      spinner.stop(pc.dim(`${skillName}: local path — cannot check for updates`));
      skippedCount++;
      continue;
    }

    // GitHub skills: check for updates
    spinner.start(`Checking ${pc.cyan(skillName)}...`);

    let needsUpdate = false;
    let updateReason = '';

    try {
      // Try skills.sh API first
      const ownerRepo = entry.source;
      const slug = skillNameToSlug(skillName);

      const remoteHash = await getSkillHash(ownerRepo, slug);

      if (remoteHash !== null) {
        // Got a hash from skills.sh
        if (remoteHash !== entry.hash) {
          needsUpdate = true;
          updateReason = 'hash changed (skills.sh)';
        } else {
          currentCount++;
          spinner.stop(`${pc.green('✓')} ${skillName} ${pc.dim('up to date')}`);
          continue;
        }
      } else {
        // skills.sh didn't have this skill — fall back to GitHub Trees API
        if (entry.skillPath) {
          try {
            const folderHash = await fetchSkillFolderHash(ownerRepo, entry.skillPath, entry.ref);
            if (folderHash) {
              // Compare using the stored hash — since we don't store the folder SHA separately,
              // we'll note this and fall through to re-install to get the latest
              // For now, we'll always try to re-install to verify
              needsUpdate = true;
              updateReason = 'checking via GitHub Trees API (no skills.sh data)';
            } else {
              spinner.stop(`${pc.dim(skillName)}: could not check (private or deleted repo)`);
              skippedCount++;
              continue;
            }
          } catch {
            spinner.stop(`${pc.dim(skillName)}: GitHub API unavailable`);
            skippedCount++;
            continue;
          }
        } else {
          spinner.stop(`${pc.dim(skillName)}: no skill path recorded, cannot check`);
          skippedCount++;
          continue;
        }
      }
    } catch {
      spinner.stop(`${pc.dim(skillName)}: could not check for updates`);
      skippedCount++;
      continue;
    }

    if (!needsUpdate) {
      currentCount++;
      continue;
    }

    // Re-install the skill
    spinner.stop(`${pc.yellow('↻')} ${skillName} ${pc.dim(updateReason)}`);

    try {
      const parsed = parseSource(entry.sourceUrl || entry.source);
      let tempDir: string | null = null;

      if (parsed.type === 'local') {
        // Should have been skipped above, but just in case
        skippedCount++;
        continue;
      }

      // Clone the repo
      tempDir = await cloneRepo(parsed.url, entry.ref);

      // Discover and find the matching skill
      const allSkills = await discoverSkills(tempDir, parsed.subpath, { includeInternal: true });
      const matching = filterSkills(allSkills, [skillName]);

      if (matching.length === 0) {
        failedCount++;
        p.log.warn(`Skill "${skillName}" not found in updated source`);
        if (tempDir) await cleanupTempDir(tempDir).catch(() => {});
        continue;
      }

      const skill = matching[0]!;
      const result = isLocal
        ? await installSkillLocal(skill, cwd)
        : await installSkillGlobal(skill);

      if (result.success) {
        // Compute new hash
        const newHash = await computeSkillHash(result.canonicalPath);

        // Update lockfile
        await addSkillToLockfile(
          sanitizeName(skillName),
          {
            ...entry,
            hash: newHash,
          },
          isLocal,
          cwd
        );

        updatedCount++;
        p.log.success(`${pc.green('✓')} Updated ${pc.cyan(skillName)}`);
      } else {
        failedCount++;
        p.log.error(`Failed to update ${skillName}: ${result.error}`);
      }

      if (tempDir) await cleanupTempDir(tempDir).catch(() => {});
    } catch (err) {
      failedCount++;
      p.log.error(
        `Failed to update ${skillName}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Summary
  console.log();
  const summaryParts: string[] = [];
  if (updatedCount > 0) summaryParts.push(pc.green(`${updatedCount} updated`));
  if (currentCount > 0) summaryParts.push(pc.dim(`${currentCount} up to date`));
  if (skippedCount > 0) summaryParts.push(pc.yellow(`${skippedCount} skipped`));
  if (failedCount > 0) summaryParts.push(pc.red(`${failedCount} failed`));

  if (summaryParts.length > 0) {
    p.note(summaryParts.join(', '), 'Summary');
  }

  console.log();
  p.outro(pc.green('Done!'));
}
