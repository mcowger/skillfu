# Agent Guidelines

## Before Pushing

- **Bump the version** in both `package.json` and `src/cli.ts` (`VERSION` constant) before pushing to `main`. Use [semver](https://semver.org):
  - **Patch** (`0.1.x`): Bug fixes, minor help text changes
  - **Minor** (`0.x.0`): New features, new commands, new flags
  - **Major** (`x.0.0`): Breaking changes to CLI interface or lockfile format
