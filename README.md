# skillfu

A minimal CLI for installing agent skills. Symlink-only, lockfile-driven.

**skillfu** gives your agents new capabilities instantly — like Neo in _The Matrix_ who instantly learns kung fu after downloading the program, skillfu instantly equips your agents with new skills.

It's a focused replacement for the Vercel `skills` CLI — it does one thing well: install, track, and update skills via symlinks with a lockfile as the source of truth.

## Install

```bash
# npm
npm install -g @mcowger/skillfu

# From source
git clone <repo-url> skillfu && cd skillfu
bun install
bun run build
```

## Commands

### `skillfu add <source>`

Install skills from a GitHub repo or local path.

```bash
# Install all skills from a repo (global)
skillfu add vercel-labs/agent-skills

# Install specific skill (positional arg)
skillfu add vercel-labs/agent-skills github-actions-docs

# Install specific skills
skillfu add vercel-labs/agent-skills --skill frontend-design --skill skill-creator

# Install to project directory (local scope)
skillfu add vercel-labs/agent-skills --skill frontend-design -l

# Install from a local path
skillfu add ./my-skills

# Install from a specific branch
skillfu add vercel-labs/agent-skills --ref develop --skill frontend-design

# Shorthand: @skill-name filter
skillfu add vercel-labs/agent-skills@frontend-design

# Shorthand: #branch reference
skillfu add vercel-labs/agent-skills#develop
```

| Option | Description |
|---|---|
| `-s, --skill <name>` | Install specific skill(s) by name. Repeatable. |
| `-l, --local` | Install to project directory (`.agents/skills/`) |
| `-y, --yes` | Skip confirmation prompts |
| `--ref <branch>` | Git branch or tag to install from |

### `skillfu remove <skill-name>...`

Remove installed skills.

```bash
skillfu remove frontend-design
skillfu remove frontend-design skill-creator
skillfu remove frontend-design -l    # from project scope
skillfu remove frontend-design -y    # skip confirmation
```

| Option | Description |
|---|---|
| `-l, --local` | Remove from project scope |
| `-y, --yes` | Skip confirmation prompts |

### `skillfu install`

Ensure installed skills match the lockfile. Idempotent — safe to run repeatedly (like `npm ci`).

```bash
skillfu install       # restore global skills from lockfile
skillfu install -l    # restore project skills from lockfile
```

| Option | Description |
|---|---|
| `-l, --local` | Install from project lockfile |

This is the primary command for:
- Setting up a new machine after cloning a repo (with `.agents/skills.lock` committed)
- Recovering from accidentally deleted symlinks
- CI/CD environments
- Removing orphaned skills not tracked in the lockfile

### `skillfu update`

Check for and install updated versions of skills.

```bash
skillfu update                          # update all global skills
skillfu update -l                       # update all project skills
skillfu update --skill frontend-design   # update a specific skill
```

| Option | Description |
|---|---|
| `-l, --local` | Update project-scoped skills |
| `-s, --skill <name>` | Update only specific skill(s) |
| `-y, --yes` | Skip confirmation prompts |

Update detection uses the [skills.sh API](https://skills.sh/docs/api) for hash comparison, falling back to the GitHub Trees API when unavailable. Local path skills cannot be updated remotely.

### `skillfu completions <shell>`

Output shell completion script.

```bash
# bash
skillfu completions bash > ~/.local/share/bash-completion/completions/skillfu

# zsh
skillfu completions zsh > ~/.zfunc/_skillfu

# fish
skillfu completions fish > ~/.config/fish/completions/skillfu.fish
```

## Storage

### Global scope (default)

```
~/.config/skillfu/
├── skills.lock                                 # Lockfile
└── skills/                                      # Canonical skill files
    └── frontend-design/
        └── SKILL.md

~/.agents/skills/                                # Symlinks (where agents look)
└── frontend-design → ~/.config/skillfu/skills/frontend-design/
```

### Local scope (`-l` flag)

```
<project>/
├── .agents/
│   ├── skills.lock                              # Project lockfile (commit this!)
│   └── skills/                                  # Skill files (no symlinks needed)
│       └── frontend-design/
│           └── SKILL.md
```

Any agent that reads from `~/.agents/skills/` (global) or `.agents/skills/` (local) picks up installed skills automatically — no agent-specific configuration needed.

## Source Formats

| Format | Example |
|---|---|
| GitHub shorthand | `vercel-labs/agent-skills` |
| Shorthand with skill filter | `vercel-labs/agent-skills@frontend-design` |
| Shorthand with branch | `vercel-labs/agent-skills#develop` |
| Shorthand with branch + skill | `vercel-labs/agent-skills#develop@frontend-design` |
| Full GitHub URL | `https://github.com/vercel-labs/agent-skills` |
| GitHub URL with branch/path | `https://github.com/vercel-labs/agent-skills/tree/main/skills/design` |
| Local path | `./my-skills` or `/absolute/path` |

## Lockfile

Skills are tracked in a lockfile that serves as the source of truth:

- **Global**: `~/.config/skillfu/skills.lock`
- **Project**: `.agents/skills.lock`

The project lockfile is designed to be committed to version control. Skills are sorted alphabetically and timestamps are omitted to minimize merge conflicts — two branches adding different skills produce non-overlapping JSON keys that git can auto-merge.

## What Are Agent Skills?

Agent skills are reusable instruction sets that extend your coding agent's capabilities. They're defined in `SKILL.md` files with YAML frontmatter:

```markdown
---
name: my-skill
description: What this skill does and when to use it
---

# My Skill

Instructions for the agent to follow when this skill is activated.
```

Discover more skills at [skills.sh](https://skills.sh).

## Environment Variables

| Variable | Description |
|---|---|
| `SKILLFU_CONFIG_DIR` | Override config directory (`~/.config/skillfu/`) |
| `SKILLFU_CLONE_TIMEOUT_MS` | Git clone timeout in ms (default: 300000) |
| `GITHUB_TOKEN` / `GH_TOKEN` | GitHub API token for higher rate limits |
| `INSTALL_INTERNAL_SKILLS` | Set to `1` to include skills marked `internal: true` |
| `SKILLFU_SKILLS_SH_KEY` | API key for skills.sh (higher rate limits) |

## Development

```bash
bun install          # Install dependencies
bun run dev add ...  # Run locally
bun test             # Run tests
bun run build        # Compile to dist/skillfu
```
