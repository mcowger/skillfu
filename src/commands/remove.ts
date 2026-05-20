import * as p from '@clack/prompts';
import pc from 'picocolors';
import { readLockfile, removeSkillFromLockfile } from '../core/lockfile.js';
import { removeSkillGlobal, removeSkillLocal, getCanonicalSkillPath, getSymlinkSkillPath } from '../core/installer.js';
import { sanitizeName, shortenPath, getBaseDir } from '../utils/paths.js';

export interface RemoveOptions {
  local?: boolean;
  yes?: boolean;
  target?: string;
}

export async function runRemove(skillNames: string[], options: RemoveOptions = {}): Promise<void> {
  const cwd = getBaseDir(options.target);
  const isLocal = options.local || !!options.target;

  console.log();
  p.intro(pc.bgCyan(pc.black(' skillfu ')));

  if (skillNames.length === 0) {
    p.log.error(pc.red('No skill names provided. Usage: skillfu remove <skill-name>...'));
    process.exit(1);
  }

  // Read lockfile to show what's installed
  const lock = await readLockfile(isLocal, cwd);
  const installedNames = Object.keys(lock.skills);

  if (installedNames.length === 0) {
    p.outro(pc.yellow('No skills found in lockfile.'));
    return;
  }

  // Validate skill names against lockfile
  const notFound = skillNames.filter(
    (name) => !lock.skills[sanitizeName(name)]
  );
  if (notFound.length > 0 && skillNames.length === notFound.length) {
    p.log.error(pc.red(`Skills not found in lockfile: ${notFound.join(', ')}`));
    p.log.info(pc.dim('Installed skills:'));
    for (const name of installedNames) {
      p.log.message(`  - ${name}`);
    }
    process.exit(1);
  }

  if (notFound.length > 0) {
    p.log.warn(pc.yellow(`Skills not found in lockfile (skipping): ${notFound.join(', ')}`));
  }

  const toRemove = skillNames.filter(
    (name) => lock.skills[sanitizeName(name)]
  );

  if (toRemove.length === 0) {
    p.outro(pc.yellow('No matching skills to remove.'));
    return;
  }

  // Confirm removal
  if (!options.yes) {
    console.log();
    p.log.info('Skills to remove:');
    for (const name of toRemove) {
      p.log.message(`  ${pc.red('•')} ${name}`);
    }
    console.log();

    const confirmed = await p.confirm({
      message: `Remove ${toRemove.length} skill(s)?`,
    });

    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel('Removal cancelled');
      process.exit(0);
    }
  }

  // Remove skills
  const spinner = p.spinner();
  spinner.start('Removing skills...');

  const results: Array<{ name: string; success: boolean; error?: string }> = [];

  for (const skillName of toRemove) {
    const sanitized = sanitizeName(skillName);
    try {
      const removed = isLocal
        ? await removeSkillLocal(sanitized, cwd)
        : await removeSkillGlobal(sanitized);

      if (removed) {
        await removeSkillFromLockfile(sanitized, isLocal, cwd);
        results.push({ name: skillName, success: true });
      } else {
        results.push({ name: skillName, success: false, error: 'Failed to remove files' });
      }
    } catch (err) {
      results.push({
        name: skillName,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  spinner.stop('Removal complete');

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  if (successful.length > 0) {
    const lines = successful.map((r) => `${pc.green('✓')} Removed ${pc.cyan(r.name)}`);
    p.note(lines.join('\n'), pc.green(`Removed ${successful.length} skill(s)`));
  }

  if (failed.length > 0) {
    console.log();
    p.log.error(pc.red(`Failed to remove ${failed.length} skill(s)`));
    for (const r of failed) {
      p.log.message(`  ${pc.red('✗')} ${r.name}: ${pc.dim(r.error)}`);
    }
  }

  console.log();
  p.outro(pc.green('Done!'));
}
