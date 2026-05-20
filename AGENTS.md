# Agent Guidelines

## Before Pushing

- **Bump the version** in `package.json` before pushing to `main`. The version in `src/cli.ts` is read from `package.json` at build time (inlined into the bundle), so `package.json` is the single source of truth. Use [semver](https://semver.org):
  - **Patch** (`0.1.x`): Bug fixes, minor help text changes
  - **Minor** (`0.x.0`): New features, new commands, new flags
  - **Major** (`x.0.0`): Breaking changes to CLI interface or lockfile format
