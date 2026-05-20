import * as p from '@clack/prompts';
import pc from 'picocolors';
import { existsSync } from 'fs';
import { join, relative, dirname, basename } from 'path';
import { parseSource } from '../core/source-parser.js';
import { discoverSkills, filterSkills, getSkillDisplayName } from '../core/skill-discovery.js';
import { installSkillGlobal, installSkillLocal, getCanonicalSkillPath, getSymlinkSkillPath } from '../core/installer.js';
import { computeSkillHash } from '../core/hash.js';
import { addSkillToLockfile } from '../core/lockfile.js';
import { cloneRepo, cleanupTempDir, GitCloneError } from '../providers/github.js';
import { resolveLocalPath } from '../providers/local.js';
import { fetchSkillAudit, skillNameToSlug, buildSourceId } from '../providers/skills-sh.js';
import { sanitizeName, shortenPath, getCanonicalSkillsDir, getBaseDir } from '../utils/paths.js';
import { ensureDir } from '../utils/fs.js';
import type { Skill } from '../core/skill-discovery.js';
import type { ParsedSource } from '../core/source-parser.js';
import type { AuditResponse } from '../providers/skills-sh.js';

export interface AddOptions {
  skill?: string[];
  local?: boolean;
  yes?: boolean;
  ref?: string;
  target?: string;
}

export async function runAdd(sourceArg: string, options: AddOptions = {}): Promise<void> {
  const cwd = getBaseDir(options.target);

  if (!sourceArg) {
    console.log();
    p.log.error(pc.red('Missing required argument: source'));
    console.log(pc.dim('  Usage:'));
    console.log(`    ${pc.cyan('skillfu add')} ${pc.yellow('<source>')} ${pc.dim('[options]')}`);
    console.log();
    console.log(pc.dim('  Example:'));
    console.log(`    ${pc.cyan('skillfu add')} ${pc.yellow('vercel-labs/agent-skills')}`);
    process.exit(1);
  }

  console.log();
  p.intro(pc.bgCyan(pc.black(' skillfu ')));

  const spinner = p.spinner();

  // Parse the source
  spinner.start('Parsing source...');
  let parsed: ParsedSource;
  try {
    parsed = parseSource(sourceArg);
  } catch (err) {
    spinner.stop(pc.red('Invalid source'));
    p.outro(pc.red(err instanceof Error ? err.message : 'Invalid source format'));
    process.exit(1);
  }

  // Merge skill filter from @skill syntax
  if (parsed.skillFilter) {
    options.skill = options.skill || [];
    if (!options.skill.includes(parsed.skillFilter)) {
      options.skill.push(parsed.skillFilter);
    }
  }

  // Merge ref from #branch syntax
  if (parsed.ref && !options.ref) {
    options.ref = parsed.ref;
  }

  const isLocal = options.local || !!options.target || parsed.type === 'local';
  const sourceDisplay = isLocal
    ? parsed.localPath!
    : parsed.ownerRepo || parsed.url;

  spinner.stop(
    `Source: ${pc.cyan(sourceDisplay)}` +
    (parsed.ref ? pc.yellow(` @ ${parsed.ref}`) : '') +
    (parsed.subpath ? pc.dim(` (${parsed.subpath})`) : '') +
    (parsed.skillFilter ? ` ${pc.dim('@')}${pc.cyan(parsed.skillFilter)}` : '')
  );

  // Include internal skills when a specific skill is explicitly requested
  const includeInternal = !!(options.skill && options.skill.length > 0);

  let tempDir: string | null = null;
  let skills: Skill[];

  try {
    if (isLocal) {
      // Local path — validate
      spinner.start('Validating local path...');
      try {
        resolveLocalPath(parsed.localPath!);
      } catch (err) {
        spinner.stop(pc.red('Path not found'));
        p.outro(pc.red(err instanceof Error ? err.message : 'Local path does not exist'));
        process.exit(1);
      }
      spinner.stop('Local path validated');

      spinner.start('Discovering skills...');
      skills = await discoverSkills(parsed.localPath!, parsed.subpath, { includeInternal });
    } else {
      // GitHub source — clone
      spinner.start('Cloning repository...');
      try {
        tempDir = await cloneRepo(parsed.url, options.ref);
      } catch (err) {
        spinner.stop(pc.red('Clone failed'));
        if (err instanceof GitCloneError) {
          p.outro(pc.red(err.message));
        } else {
          p.outro(pc.red(`Failed to clone ${parsed.url}: ${err instanceof Error ? err.message : String(err)}`));
        }
        process.exit(1);
      }
      spinner.stop('Repository cloned');

      spinner.start('Discovering skills...');
      skills = await discoverSkills(tempDir, parsed.subpath, { includeInternal });
    }

    if (skills.length === 0) {
      spinner.stop(pc.red('No skills found'));
      p.outro(pc.red('No valid skills found. Skills require a SKILL.md with name and description.'));
      await cleanup(tempDir);
      process.exit(1);
    }

    spinner.stop(`Found ${pc.green(skills.length)} skill${skills.length > 1 ? 's' : ''}`);

    // Filter skills if --skill option is provided
    let selectedSkills: Skill[];
    if (options.skill && options.skill.length > 0) {
      selectedSkills = filterSkills(skills, options.skill);
      if (selectedSkills.length === 0) {
        p.log.error(`No matching skills found for: ${options.skill.join(', ')}`);
        p.log.info('Available skills:');
        for (const s of skills) {
          p.log.message(`  - ${getSkillDisplayName(s)}`);
        }
        await cleanup(tempDir);
        process.exit(1);
      }
      p.log.info(
        `Selected ${selectedSkills.length} skill${selectedSkills.length !== 1 ? 's' : ''}: ${selectedSkills.map((s) => pc.cyan(getSkillDisplayName(s))).join(', ')}`
      );
    } else if (skills.length === 1) {
      selectedSkills = skills;
      p.log.info(`Skill: ${pc.cyan(getSkillDisplayName(skills[0]!))}`);
      p.log.message(pc.dim(skills[0]!.description));
    } else if (options.yes) {
      selectedSkills = skills;
      p.log.info(`Installing all ${skills.length} skills`);
    } else {
      // Interactive skill selection
      const skillChoices = skills
        .sort((a, b) => getSkillDisplayName(a).localeCompare(getSkillDisplayName(b)))
        .map((s) => ({
          value: s,
          label: getSkillDisplayName(s),
          hint: s.description.length > 60 ? s.description.slice(0, 57) + '...' : s.description,
        }));

      const selected = await p.multiselect({
        message: `Select skills to install ${pc.dim('(space to toggle)')}`,
        options: skillChoices as any,
        required: true,
      });

      if (p.isCancel(selected)) {
        p.cancel('Installation cancelled');
        await cleanup(tempDir);
        process.exit(0);
      }

      selectedSkills = selected as Skill[];
    }

    // Kick off security audit fetch in parallel
    const auditPromise = parsed.ownerRepo
      ? Promise.all(
          selectedSkills.map(async (skill) => {
            const slug = skillNameToSlug(skill.name);
            try {
              const audit = await fetchSkillAudit(parsed.ownerRepo!, slug);
              return { skillName: skill.name, audit };
            } catch {
              return { skillName: skill.name, audit: null };
            }
          })
        )
      : Promise.resolve([]);

    // Build installation summary
    const summaryLines: string[] = [];
    for (const skill of selectedSkills) {
      if (summaryLines.length > 0) summaryLines.push('');

      if (options.local) {
        const skillPath = getCanonicalSkillPath(skill.name, true, cwd);
        summaryLines.push(`${pc.cyan(shortenPath(skillPath, cwd))}`);
      } else {
        const canonicalPath = getCanonicalSkillPath(skill.name, false);
        const symlinkPath = getSymlinkSkillPath(skill.name);
        summaryLines.push(`${pc.cyan(shortenPath(canonicalPath, cwd))}`);
        summaryLines.push(`  ${pc.dim('symlink →')} ${shortenPath(symlinkPath, cwd)}`);
      }
    }

    console.log();
    p.note(summaryLines.join('\n'), 'Installation Summary');

    // Display security audits
    try {
      const auditResults = await auditPromise;
      const securityLines: string[] = [];
      for (const { skillName, audit } of auditResults) {
        if (!audit || audit.audits.length === 0) continue;
        const name = skillName;
        for (const entry of audit.audits) {
          const risk = entry.riskLevel
            ? riskLabel(entry.riskLevel)
            : entry.status === 'pass'
              ? pc.green('Pass')
              : entry.status === 'warn'
                ? pc.yellow('Warn')
                : pc.red('Fail');
          securityLines.push(`  ${pc.cyan(name)} ${pc.dim('(')}${entry.provider}${pc.dim(')')}: ${risk}`);
          if (entry.summary) {
            securityLines.push(`    ${pc.dim(entry.summary)}`);
          }
        }
      }
      if (securityLines.length > 0) {
        p.note(securityLines.join('\n'), 'Security Risk Assessments');
      }
    } catch {
      // Silently skip audit display
    }

    // Confirm installation
    if (!options.yes) {
      const confirmed = await p.confirm({ message: 'Proceed with installation?' });
      if (p.isCancel(confirmed) || !confirmed) {
        p.cancel('Installation cancelled');
        await cleanup(tempDir);
        process.exit(0);
      }
    }

    // Install skills
    spinner.start('Installing skills...');

    const results: Array<{
      skill: string;
      success: boolean;
      canonicalPath: string;
      symlinkPath?: string;
      mode: 'direct' | 'symlink';
      error?: string;
    }> = [];

    for (const skill of selectedSkills) {
      const result = options.local
        ? await installSkillLocal(skill, cwd)
        : await installSkillGlobal(skill);

      results.push({
        skill: getSkillDisplayName(skill),
        ...result,
      });
    }

    spinner.stop('Installation complete');

    // Update lockfile
    const successful = results.filter((r) => r.success);
    if (successful.length > 0) {
      for (let i = 0; i < selectedSkills.length; i++) {
        const skill = selectedSkills[i]!;
        const result = results[i]!;
        if (!result.success) continue;

        // Compute hash from installed files
        let hash: string;
        try {
          hash = await computeSkillHash(result.canonicalPath);
        } catch {
          hash = '';
        }

        // Determine the skillPath (relative path within the source repo)
        const isLocalSource = parsed.type === 'local';
        let skillPath: string | undefined;
        if (tempDir && isLocalSource) {
          skillPath = relative(parsed.localPath!, skill.path).replace(/\\/g, '/');
        } else if (tempDir) {
          skillPath = relative(tempDir, skill.path).replace(/\\/g, '/');
        }

        // Determine source for lockfile
        const lockSource = isLocalSource ? parsed.localPath! : (parsed.ownerRepo || parsed.url);
        const lockSourceType = isLocalSource ? 'local' : 'github';

        await addSkillToLockfile(
          sanitizeName(skill.name),
          {
            source: lockSource,
            sourceType: lockSourceType,
            sourceUrl: isLocalSource ? parsed.localPath! : parsed.url,
            skillPath,
            ref: options.ref,
            hash,
          },
          isLocal,
          cwd
        );
      }
    }

    // Display results
    console.log();
    if (successful.length > 0) {
      const resultLines: string[] = [];
      for (const r of successful) {
        if (r.mode === 'symlink') {
          resultLines.push(`${pc.green('✓')} ${shortenPath(r.canonicalPath, cwd)}`);
          if (r.symlinkPath) {
            resultLines.push(`  ${pc.dim('symlink →')} ${shortenPath(r.symlinkPath, cwd)}`);
          }
        } else {
          resultLines.push(`${pc.green('✓')} ${shortenPath(r.canonicalPath, cwd)}`);
        }
      }

      p.note(resultLines.join('\n'), pc.green(`Installed ${successful.length} skill${successful.length !== 1 ? 's' : ''}`));
    }

    const failed = results.filter((r) => !r.success);
    if (failed.length > 0) {
      console.log();
      p.log.error(pc.red(`Failed to install ${failed.length} skill(s)`));
      for (const r of failed) {
        p.log.message(`  ${pc.red('✗')} ${r.skill}: ${pc.dim(r.error)}`);
      }
    }

    console.log();
    p.outro(
      pc.green('Done!') + pc.dim('  Review skills before use; they run with full agent permissions.')
    );

    await cleanup(tempDir);
  } catch (err) {
    await cleanup(tempDir);
    throw err;
  }
}

function riskLabel(risk: string): string {
  switch (risk.toUpperCase()) {
    case 'CRITICAL':
      return pc.red(pc.bold('Critical Risk'));
    case 'HIGH':
      return pc.red('High Risk');
    case 'MEDIUM':
      return pc.yellow('Med Risk');
    case 'LOW':
      return pc.green('Low Risk');
    case 'NONE':
      return pc.green('Safe');
    default:
      return pc.dim('--');
  }
}

async function cleanup(tempDir: string | null) {
  if (tempDir) {
    try {
      await cleanupTempDir(tempDir);
    } catch {
      // Ignore cleanup errors
    }
  }
}
