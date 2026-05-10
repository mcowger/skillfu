# Brief — Design Document

> A minimal CLI for installing agent skills. Focused scope, symlink-only, lockfile-driven.

## 1. Overview

**Brief** is a replacement for the Vercel `skills` CLI, deliberately narrowing scope while adding reliable lockfile management and update detection. Where `skills` tries to be a full ecosystem tool (search, discovery, multi-agent management, copy/symlink modes), brief does one thing well: **install, track, and update skills via symlinks with a lockfile as the source of truth.**

### Key Differences from `skills`

| Aspect | `skills` | `brief` |
|---|---|---|
| Multi-agent support | 50+ agents, symlinks to each | Single target: `~/.agents/skills` (global) or `.agents/skills` (local) |
| Install methods | Symlink or copy | Symlink only |
| Discovery/search | `find`, `list`, skills.sh API | None — removed entirely |
| Lockfile | Global only (`~/.agents/.skill-lock.json`), separate project lock (`skills-lock.json`) | Separate lockfiles per scope, co-located with skill files |
| Update detection | GitHub Trees API folder hash | skills.sh API |
| Source formats | GitHub, GitLab, well-known, git URLs, local | GitHub shorthand, GitHub URLs, local paths |
| Agent detection | Auto-detects installed agents | No agent detection — just manages symlinks |
| Interactive prompts | Many (agent selection, scope, mode, skill selection) | Minimal — only confirm overwrites |

## 2. Commands

### `brief add <source> [--skill <name>...] [-l]`

Install one or more skills from a source repository or local path.

**Source formats:**
- `owner/repo` — GitHub shorthand (e.g., `vercel-labs/agent-skills`)
- `https://github.com/owner/repo` — Full GitHub URL
- `https://github.com/owner/repo/tree/branch/path` — GitHub URL with branch and subpath
- `./local/path` — Local directory containing skills

**Options:**
| Flag | Description |
|---|---|
| `-s, --skill <name>` | Install specific skill(s) by name. Can be repeated. Omit to install all skills. |
| `-l, --local` | Install to project directory (`.agents/skills/`) instead of global (`~/.agents/skills/`) |
| `-y, --yes` | Skip confirmation prompts |
| `--ref <branch>` | Git branch/tag to install from (default: repository default branch) |

**Behavior:**
1. Parse and resolve the source (clone to temp dir if remote, validate if local)
2. Discover skills in the source (scan for `SKILL.md` files in standard locations)
3. Filter to requested `--skill` names if provided
4. For each skill:
   - Copy skill files to `~/.config/brief/skills/<skill-name>/` (global) or `.agents/skills/<skill-name>/` (local)
   - Create symlink from `~/.agents/skills/<skill-name>` → `~/.config/brief/skills/<skill-name>/` (global) — **or** if `-l`, no symlink needed since files are already in `.agents/skills/`
   - Update the lockfile
5. Clean up temp dir

**Examples:**
```bash
# Install all skills from a repo (global)
brief add vercel-labs/agent-skills

# Install specific skills (global)
brief add vercel-labs/agent-skills --skill frontend-design --skill skill-creator

# Install to project directory
brief add vercel-labs/agent-skills --skill frontend-design -l

# Install from a local path
brief add ./my-skills

# Install from a specific branch
brief add vercel-labs/agent-skills --ref develop --skill frontend-design
```

### `brief remove <skill-name>... [-l]`

Remove one or more installed skills.

**Options:**
| Flag | Description |
|---|---|
| `-l, --local` | Remove from project scope (`.agents/skills/`) instead of global |
| `-y, --yes` | Skip confirmation prompts |

**Behavior:**
1. Look up the skill in the lockfile
2. Remove the symlink at `~/.agents/skills/<skill-name>` (global) or `.agents/skills/<skill-name>` (local)
3. Remove the canonical skill files at `~/.config/brief/skills/<skill-name>/` (global) or `.agents/skills/<skill-name>/` (local)
4. Remove the entry from the lockfile

### `brief install [-l]`

Ensure the installed skills match the lockfile. Idempotent — safe to run repeatedly (like `npm ci`).

**Options:**
| Flag | Description |
|---|---|
| `-l, --local` | Install from project lockfile instead of global |

**Behavior:**
1. Read the lockfile
2. For each skill entry in the lockfile:
   - If the symlink and canonical files exist and match → skip
   - If files are missing → re-install from the recorded source
3. Remove any skills on disk that are NOT in the lockfile (orphans)

This is the primary command for:
- Setting up a new machine after cloning a repo (with `.agents/skills.lock` committed)
- Recovering from accidentally deleted symlinks
- CI/CD environments

### `brief update [-l] [--skill <name>...]`

Check for and install updated versions of skills.

**Options:**
| Flag | Description |
|---|---|
| `-l, --local` | Update project-scoped skills instead of global |
| `-s, --skill <name>` | Update only specific skill(s) by name. Omit to update all. |
| `-y, --yes` | Skip confirmation prompts |

**Behavior:**
1. Read the lockfile
2. For each skill (or filtered skills):
   - Query the skills.sh API for the current `hash` of the skill
   - Compare with the `hash` stored in the lockfile
   - If different → re-install from the recorded source and update the lockfile entry
3. Report which skills were updated, which are current, and which couldn't be checked

**skills.sh API Integration:**

Use `GET /api/v1/skills/{source}/{skill}` to fetch the current hash:
```
GET https://skills.sh/api/v1/skills/vercel-labs/agent-skills/frontend-design
```

Response includes a `hash` field (SHA-256 of the skill's file contents). Compare this with the stored hash in the lockfile. No API key required for basic usage (60 req/min rate limit).

**Fallback:** If the skills.sh API is unavailable or the skill isn't indexed, fall back to the GitHub Trees API approach (fetch repo tree SHA, compare with stored folder hash).

## 3. File Layout

### Global Scope (default)

```
~/.config/brief/
├── skills.lock              # Global lockfile
└── skills/                   # Canonical skill file storage
    ├── frontend-design/
    │   ├── SKILL.md
    │   └── examples/
    │       └── app-router.ts
    └── skill-creator/
        └── SKILL.md

~/.agents/skills/             # Symlink target (where agents look)
├── frontend-design -> ~/.config/brief/skills/frontend-design/
└── skill-creator -> ~/.config/brief/skills/skill-creator/
```

### Local Scope (`-l` flag)

```
<project>/
├── .agents/
│   ├── skills.lock           # Project lockfile (committed to VCS)
│   └── skills/               # Skill files (no symlinks needed — agents read from here directly)
│       ├── frontend-design/
│       │   └── SKILL.md
│       └── skill-creator/
│           └── SKILL.md
```

**Key insight:** In local scope, skill files live directly in `.agents/skills/` — the same directory agents already read from. No symlinks needed. This matches the pattern of many agents (Amp, Cline, Cursor, etc.) that look in `.agents/skills/`.

## 4. Lockfile Schema

### Global Lockfile: `~/.config/brief/skills.lock`

```jsonc
{
  "version": 1,
  "skills": {
    "frontend-design": {
      "source": "vercel-labs/agent-skills",
      "sourceType": "github",
      "sourceUrl": "https://github.com/vercel-labs/agent-skills.git",
      "skillPath": "skills/frontend-design",
      "ref": "main",
      "hash": "a1b2c3d4...",   // SHA-256 from skills.sh API or computed locally
      "installedAt": "2026-05-09T12:00:00.000Z",
      "updatedAt": "2026-05-09T12:00:00.000Z"
    },
    "skill-creator": {
      "source": "vercel-labs/agent-skills",
      "sourceType": "github",
      "sourceUrl": "https://github.com/vercel-labs/agent-skills.git",
      "skillPath": "skills/skill-creator",
      "ref": "main",
      "hash": "e5f6g7h8...",
      "installedAt": "2026-05-09T12:00:00.000Z",
      "updatedAt": "2026-05-09T12:00:00.000Z"
    }
  }
}
```

### Project Lockfile: `.agents/skills.lock`

Same schema, but intentionally minimal for clean VCS diffs:

```jsonc
{
  "version": 1,
  "skills": {
    "frontend-design": {
      "source": "vercel-labs/agent-skills",
      "sourceType": "github",
      "sourceUrl": "https://github.com/vercel-labs/agent-skills.git",
      "skillPath": "skills/frontend-design",
      "ref": "main",
      "hash": "a1b2c3d4..."
    },
    "local-helper": {
      "source": "./local-skills",
      "sourceType": "local",
      "hash": "computed-sha256..."
    }
  }
}
```

**Design notes:**
- Skills are sorted alphabetically by key when written (deterministic output, clean diffs)
- Project lockfile omits timestamps to minimize merge conflicts (two branches adding different skills produce non-overlapping keys that git can auto-merge)
- `hash` is SHA-256 of the skill's file contents, sourced from skills.sh API when available, or computed locally on install
- `skillPath` records the subdirectory within the source repo — needed for scoped re-install during `update`
- `sourceType` is `"github"` or `"local"` — brief only supports these two

## 5. Skill Discovery

When scanning a source (cloned repo or local dir), brief looks for `SKILL.md` files in this priority order:

1. **Root directory** — if it contains `SKILL.md`, it's a single-skill repo
2. **`skills/`** — standard skill directory
3. **`skills/.curated/`** — curated subdirectory
4. **`skills/.experimental/`** — experimental subdirectory
5. **`.agents/skills/`** — agent-standard location
6. **Recursive fallback** — if nothing found above, scan all subdirectories up to depth 5

A valid skill directory must contain a `SKILL.md` with YAML frontmatter having both `name` and `description` fields.

**Internal skills** (those with `metadata.internal: true` in frontmatter) are excluded from discovery unless:
- The skill is explicitly requested by name via `--skill`, OR
- The environment variable `INSTALL_INTERNAL_SKILLS=1` is set

## 6. Architecture

### Tech Stack

- **Runtime:** Bun
- **Language:** TypeScript
- **CLI Framework:** `commander` or `citty` (lightweight, Bun-friendly)
- **Interactive prompts:** `@clack/prompts` (same as skills — polished UX)
- **Git operations:** `simple-git` (same as skills — shallow clone support)
- **HTTP:** `fetch` (native in Bun)
- **Testing:** `bun:test`

### Module Structure

```
src/
├── cli.ts                # Entry point, command routing
├── commands/
│   ├── add.ts            # brief add <source>
│   ├── remove.ts         # brief remove <skill>
│   ├── install.ts        # brief install
│   └── update.ts         # brief update
├── core/
│   ├── source-parser.ts  # Parse GitHub shorthand, URLs, local paths
│   ├── skill-discovery.ts # Find SKILL.md files in a directory
│   ├── installer.ts      # Symlink creation, file copy, path validation
│   ├── lockfile.ts       # Read/write lockfile (global + project)
│   ├── hash.ts           # SHA-256 computation for skill files
│   └── frontmatter.ts    # YAML frontmatter parsing
├── providers/
│   ├── github.ts         # GitHub clone + tree operations
│   ├── local.ts          # Local path resolution
│   └── skills-sh.ts      # skills.sh API client (hash lookup, skill details)
└── utils/
    ├── paths.ts          # XDG paths, sanitize names, path traversal prevention
    └── fs.ts             # File system helpers (symlinks, cleanup)
```

### Key Design Principles

1. **Lockfile as source of truth.** The lockfile records exactly what should be installed. `brief install` makes the filesystem match the lockfile. This is the `npm ci` / `pnpm install --frozen-lockfile` philosophy.

2. **Symlink-only.** No copy mode. Canonical files live in `~/.config/brief/skills/` (global) or `.agents/skills/` (local). Global installs create a symlink from `~/.agents/skills/<name>` to the canonical location. Local installs put files directly in `.agents/skills/` — no symlink needed since agents read from there.

3. **No agent detection.** Brief doesn't try to detect which coding agents are installed. It manages skills in the standard `~/.agents/skills/` (global) and `.agents/skills/` (project) directories. Any agent that reads from these locations gets the skills.

4. **Minimal interactivity.** Brief should be usable in CI/CD and agent contexts without prompts. The `-y` flag skips confirmations. Most operations have sensible defaults.

5. **Separation of storage and symlink.** Global scope separates the canonical skill files (`~/.config/brief/skills/`) from the symlink location (`~/.agents/skills/`). This keeps brief's data isolated and makes uninstall clean, while still placing symlinks where agents expect them.

## 7. Source Parsing

Brief supports three source types:

### GitHub Shorthand: `owner/repo`
- Expanded to `https://github.com/owner/repo.git`
- Supports subpath: `owner/repo/skills/my-skill`
- Supports skill filter: `owner/repo@skill-name`
- Supports ref: `owner/repo#branch-name` or `owner/repo#branch@skill-name`

### Full GitHub URL: `https://github.com/owner/repo`
- Supports `/tree/branch/path` subpath syntax
- `.git` suffix stripped/normalized

### Local Path: `./path` or `/absolute/path`
- Must be an existing directory
- Validated on `add` — error if not found
- Recorded in lockfile with `sourceType: "local"`

**Not supported** (deliberately omitted):
- GitLab URLs
- Well-known / RFC 8615 discovery
- Generic git URLs (SSH, etc.)
- `npm:` / `node_modules` sync

## 8. Update Flow

```
brief update
      │
      ▼
 Read lockfile
      │
      ▼
 For each skill entry
      │
      ├── sourceType === "local"? ──→ Skip (local paths not updateable)
      │
      ├── Query skills.sh API ──→ GET /api/v1/skills/{source}/{skill}
      │       │
      │       ├── Success with hash ──→ Compare with lockfile hash
      │       │       │
      │       │       ├── Hashes match ──→ "Up to date"
      │       │       └── Hashes differ ──→ Re-install from source, update lockfile
      │       │
      │       └── 404 or error ──→ Fall back to GitHub Trees API
      │
      └── skills.sh API unavailable ──→ Fall back to GitHub Trees API
              │
              ▼
         Fetch repo tree SHA ──→ Compare with stored folder hash
              │
              ├── Match ──→ "Up to date"
              └── Differ ──→ Re-install from source, update lockfile
```

**GitHub Token:** Optional. Brief reads `GITHUB_TOKEN`, `GH_TOKEN`, or `gh auth token` for higher rate limits. Not required for public repos.

## 9. Error Handling

| Scenario | Behavior |
|---|---|
| Source not found (invalid owner/repo) | Error with clear message. Suggest checking the source. |
| Skill name not found in source | Error listing available skill names from the source. |
| Symlink creation fails (e.g., Windows) | Error with instructions to enable Developer Mode. Do NOT fall back to copy. |
| Lockfile corrupted | Warn and recreate empty lockfile. User must re-add skills. |
| Skills.sh API down | Fall back to GitHub Trees API. If that also fails, warn and skip. |
| Skill already installed (re-add) | Overwrite silently. Update lockfile entry. |
| Path traversal in skill name | Reject with error. Sanitize names (lowercase, hyphens only). |
| Temp dir clone timeout | Error after 5 min. Suggest `SKILLS_CLONE_TIMEOUT_MS` env var. |

## 10. Security

- **Path traversal prevention:** Skill names are sanitized (lowercase, hyphens only, max 255 chars). All resolved paths are validated to be within the expected base directory before any filesystem operations.
- **Skill content trust:** Brief displays a warning after install: "Review skills before use; they run with full agent permissions." No automatic execution — skills are instruction files, not code.
- **skills.sh API audit data:** On `add`, brief can optionally display security audit results from the skills.sh `/api/v1/skills/audit/{source}/{skill}` endpoint (Gen Agent Trust Hub, Socket, Snyk risk assessments).
- **No telemetry.** Unlike the Vercel `skills` tool, brief collects no usage data.

## 11. Implementation Plan

### Phase 1: Core (MVP)
- [ ] Project setup: Bun + TypeScript, CLI framework, build config
- [ ] Source parser (`owner/repo`, GitHub URL, local path)
- [ ] Skill discovery (SKILL.md scanning)
- [ ] `brief add` — clone, discover, install, lockfile write
- [ ] `brief remove` — delete files/symlinks, lockfile update
- [ ] Lockfile read/write (both scopes)
- [ ] Path sanitization and security validation

### Phase 2: Lockfile-Driven Operations
- [ ] `brief install` — idempotent restore from lockfile
- [ ] `brief update` — skills.sh API hash comparison + re-install
- [ ] GitHub Trees API fallback for update detection
- [ ] Orphan detection in `brief install` (remove skills not in lockfile)

### Phase 3: Polish
- [ ] Interactive prompts with `@clack/prompts` (confirm overwrites, skill selection)
- [ ] Security audit display on `add`
- [ ] Colored output, spinner, summary display
- [ ] `--ref` flag for branch/tag targeting
- [ ] `@skill-name` shorthand in source
- [ ] Comprehensive error messages and recovery hints
- [ ] Man page / help text

### Phase 4: Distribution
- [ ] `bun build` compile to single binary
- [ ] Homebrew formula
- [ ] npm package (as fallback)
- [ ] Shell completions (bash, zsh, fish)

## 12. CLI Reference (Full)

```
Usage: brief <command> [options]

Commands:
  add <source>      Install skills from a GitHub repo or local path
  remove <skills>   Remove installed skills
  install           Ensure installed skills match the lockfile
  update            Update skills to their latest versions

Add Options:
  -s, --skill <name>   Install specific skill(s) by name (repeatable)
  -l, --local          Install to project directory (.agents/skills/)
  -y, --yes            Skip confirmation prompts
  --ref <branch>       Git branch or tag to install from

Remove Options:
  -l, --local          Remove from project scope
  -y, --yes            Skip confirmation prompts

Install Options:
  -l, --local          Install from project lockfile

Update Options:
  -l, --local          Update project-scoped skills
  -s, --skill <name>   Update only specific skill(s)
  -y, --yes            Skip confirmation prompts

Global Options:
  -h, --help           Show help
  -v, --version        Show version
```

## 13. Environment Variables

| Variable | Description |
|---|---|
| `BRIEF_CONFIG_DIR` | Override default config directory (`~/.config/brief/`) |
| `BRIEF_CLONE_TIMEOUT_MS` | Git clone timeout in milliseconds (default: 300000 = 5 min) |
| `GITHUB_TOKEN` / `GH_TOKEN` | GitHub API token for higher rate limits |
| `INSTALL_INTERNAL_SKILLS` | Set to `1` to include skills marked `internal: true` |
| `NO_COLOR` | Disable colored output |

## 14. Open Questions / Future Considerations

1. **`brief init` command?** Could add a command to create a new `SKILL.md` template, but this is low priority since the primary use case is consuming skills, not authoring them.

2. **Checksum verification?** Should `brief install` verify that the files on disk match the hash in the lockfile? This would detect manual edits to skill files but add complexity.

3. **Multi-source skill names?** If two different repos provide a skill with the same name, brief currently overwrites. Should we namespace by source (e.g., `vercel-labs/frontend-design`)? The Vercel `skills` tool doesn't do this, and it adds user-facing complexity.

4. **skills.sh authentication?** The skills.sh API supports API keys for higher rate limits (600/min vs 60/min). Brief could support `BRIEF_SKILLS_SH_KEY` for power users.

5. **Global + local overlap?** If a skill is installed both globally and locally with the same name, which takes precedence? Since agents typically check `.agents/skills/` before `~/.agents/skills/`, the local one wins by convention — but brief doesn't enforce this.
