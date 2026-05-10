#!/usr/bin/env bun

import { Command } from 'commander';
import { runAdd } from './commands/add.js';
import { runRemove } from './commands/remove.js';
import { runInstall } from './commands/install.js';
import { runUpdate } from './commands/update.js';

// Embed completion scripts — Bun bundles these as strings at build time
import BASH_COMPLETION from '../completions/skillfu.bash' with { type: 'text' };
import ZSH_COMPLETION from '../completions/_skillfu' with { type: 'text' };
import FISH_COMPLETION from '../completions/skillfu.fish' with { type: 'text' };

const VERSION = '0.1.1';

const COMPLETIONS: Record<string, string> = {
  bash: BASH_COMPLETION,
  zsh: ZSH_COMPLETION,
  fish: FISH_COMPLETION,
};

const program = new Command();

program
  .name('skillfu')
  .description('A minimal CLI for installing agent skills. Symlink-only, lockfile-driven.')
  .version(VERSION)
  .addHelpText('after', `
Examples:
  $ skillfu add vercel-labs/agent-skills
  $ skillfu add vercel-labs/agent-skills --skill frontend-design --skill skill-creator
  $ skillfu add vercel-labs/agent-skills -l --skill frontend-design
  $ skillfu add ./my-local-skills
  $ skillfu add owner/repo@skill-name
  $ skillfu add owner/repo#branch-name
  $ skillfu remove frontend-design
  $ skillfu install
  $ skillfu update

Storage:
  Global:  ~/.config/skillfu/skills/  (canonical)  →  ~/.agents/skills/  (symlink)
  Local:   .agents/skills/  (direct — no symlink needed)

Lockfiles:
  Global:  ~/.config/skillfu/skills.lock
  Local:   .agents/skills.lock

Environment:
  SKILLFU_CONFIG_DIR         Override config directory (~/.config/skillfu/)
  SKILLFU_CLONE_TIMEOUT_MS   Git clone timeout in ms (default: 300000)
  GITHUB_TOKEN / GH_TOKEN    GitHub API token for higher rate limits
  INSTALL_INTERNAL_SKILLS    Set to "1" to include internal skills
  SKILLFU_SKILLS_SH_KEY      API key for skills.sh (higher rate limits)
`);

program
  .command('add <source> [skill]')
  .description('Install skills from a GitHub repo or local path')
  .usage('<source> [skill] [options]')
  .option('-s, --skill <name>', 'Install specific skill(s) by name (repeatable)', collectSkills, [])
  .option('-l, --local', 'Install to project directory (.agents/skills/)')
  .option('-y, --yes', 'Skip confirmation prompts')
  .option('--ref <branch>', 'Git branch or tag to install from')
  .addHelpText('after', `
Source formats:
  owner/repo                        GitHub shorthand
  owner/repo@skill-name             GitHub shorthand with skill filter
  owner/repo#branch                 GitHub shorthand with branch
  owner/repo#branch@skill-name     GitHub shorthand with branch and skill
  https://github.com/owner/repo    Full GitHub URL
  ./path or /abs/path              Local directory

Examples:
  $ skillfu add vercel-labs/agent-skills
  $ skillfu add vercel-labs/agent-skills github-actions-docs
  $ skillfu add vercel-labs/agent-skills --skill frontend-design
  $ skillfu add vercel-labs/agent-skills@frontend-design
  $ skillfu add vercel-labs/agent-skills#develop --skill frontend-design
  $ skillfu add https://github.com/vercel-labs/agent-skills
  $ skillfu add ./my-skills
`)
  .action(async (source, skill, opts) => {
    // If skill positional arg provided, add it to the options.skill array
    if (skill) {
      opts.skill = opts.skill || [];
      if (!opts.skill.includes(skill)) {
        opts.skill.push(skill);
      }
    }
    await runAdd(source, opts);
  });

program
  .command('remove <skills...>')
  .description('Remove installed skills')
  .usage('<skill-name> [skill-name...] [options]')
  .option('-l, --local', 'Remove from project scope')
  .option('-y, --yes', 'Skip confirmation prompts')
  .addHelpText('after', `
Examples:
  $ skillfu remove frontend-design
  $ skillfu remove frontend-design skill-creator
  $ skillfu remove frontend-design -l
  $ skillfu remove frontend-design -y
`)
  .action(async (skills, opts) => {
    await runRemove(skills, opts);
  });

program
  .command('install')
  .description('Ensure installed skills match the lockfile (idempotent)')
  .option('-l, --local', 'Install from project lockfile')
  .addHelpText('after', `
This command makes the filesystem match the lockfile — similar to "npm ci".
It restores any missing skills and removes orphaned skills not in the lockfile.

Examples:
  $ skillfu install          # restore global skills from lockfile
  $ skillfu install -l       # restore project skills from lockfile
`)
  .action(async (opts) => {
    await runInstall(opts);
  });

program
  .command('update')
  .description('Update skills to their latest versions')
  .option('-l, --local', 'Update project-scoped skills')
  .option('-s, --skill <name>', 'Update only specific skill(s)', collectSkills, [])
  .option('-y, --yes', 'Skip confirmation prompts')
  .addHelpText('after', `
Checks for updates using the skills.sh API, falling back to GitHub Trees API.
Local path skills cannot be updated remotely.

Examples:
  $ skillfu update                  # update all global skills
  $ skillfu update -l               # update all project skills
  $ skillfu update --skill frontend-design
  $ skillfu update -l --skill frontend-design
`)
  .action(async (opts) => {
    await runUpdate(opts);
  });

program
  .command('completions <shell>')
  .description('Output shell completion script')
  .addHelpText('after', `
Supported shells: bash, zsh, fish

Install:
  bash:  skillfu completions bash > ~/.local/share/bash-completion/completions/skillfu
  zsh:   skillfu completions zsh > ~/.zfunc/_skillfu
  fish:  skillfu completions fish > ~/.config/fish/completions/skillfu.fish
`)
  .action((shell) => {
    const validShells = ['bash', 'zsh', 'fish'];
    if (!validShells.includes(shell)) {
      console.error(`Unsupported shell: ${shell}. Must be one of: ${validShells.join(', ')}`);
      process.exit(1);
    }
    console.log(COMPLETIONS[shell]);
  });

/**
 * Collect repeated --skill flags into an array.
 */
function collectSkills(value: string, previous: string[]): string[] {
  return [...previous, value];
}

program.parse();
