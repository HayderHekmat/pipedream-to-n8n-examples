# Agent Guidelines

This document provides guidance for AI agents working on this repository.

## Workflow Validation

### Before Pushing Changes

Always run validation before committing workflow changes:

```bash
npm test
```

This runs:
1. **Workflow Structure Validation** (`npm run validate`) - Verifies JSON structure, node types, and typeVersions against **both** pinned packages
2. **Import Verification** (`npm run verify-import`) - Confirms all nodes and connections are present and correct

### Node Type & Version Verification

**Critical**: Every node type and `typeVersion` must exist in **both** published packages, not documentation or source:

- `n8n-nodes-base@2.4.5` (what self-hosted n8n 2.4.6 ships) via the `n8n-nodes-base-2-4-5` alias
- `n8n-nodes-base@2.15.1`
- Never use node versions from unpublished branches or master
- The validator instantiates real node classes from each package's `dist/nodes/`

Crypto is version **1** only in 2.4.5; 2.15.1 adds v2. Example workflows must use v1 so n8n 2.4.6 can import them.

Example verification:
```bash
node -e "const Slack = require('./node_modules/n8n-nodes-base/dist/nodes/Slack/Slack.node.js').Slack; console.log(new Slack().description.defaultVersion, Object.keys(new Slack().nodeVersions));"
```

## Code Quality

### Keep Changes Minimal

- Make focused, single-purpose commits
- Avoid unnecessary refactoring or reformatting
- Don't add features that weren't requested
- Keep dependencies minimal

### Workflow Examples

When adding new workflow examples:
- Include both Pipedream and n8n versions
- Provide sample data for testing with pinData
- Document setup steps and credential requirements
- Ensure all node parameters are complete and correct

## Available Skills

This repository includes curated skills from [mattpocock/skills](https://github.com/mattpocock/skills) (see `.cursor/THIRD_PARTY_NOTICES.md`):

- **`/code-review`** - Two-axis review (Standards & Spec) of changes
- **`/diagnosing-bugs`** - Disciplined debugging loop for hard bugs
- **`/pr`** - Format pull requests with visual summaries and evidence
- **`/research`** - Investigate technical questions against primary sources
- **`/tdd`** - Test-driven development with red-green-refactor

Use these when relevant to improve code quality and workflow.
