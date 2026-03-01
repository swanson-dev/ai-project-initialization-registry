# Project Contract

This contract defines the required output structure for generated projects and the minimum metadata files that must exist.

## Required project structure

Generated repositories MUST include:

- `/app` (all implementation code)
- `/docs` with these required subfolders:
  - `00-overview`
  - `01-requirements`
  - `02-architecture`
  - `03-ui-ux`
  - `04-project-management`
  - `05-research`
  - `06-decisions`
  - `07-status`
  - `08-testing-quality`
  - `09-release`
  - `10-implementation`

## Required metadata files

Generated repositories MUST include the following metadata/governance files at minimum:

- `README.md`
- `USAGE.md`
- `project-contract.md`

If this registry is materialized in full, it SHOULD also include:

- `manifest.json`
- `manifest-schema.md`
- `CONTRIBUTING.md`

## Contract rules

- No implementation code may exist outside `/app`.
- Planning artifacts MUST precede implementation.
- UI changes MUST pass mockup + explicit approval before UI implementation.
- Feature delivery MUST include required doc updates.

## Compliance checks

A project is contract-compliant only if:

1. Every required folder exists.
2. Required metadata files exist.
3. No code outside `/app`.
4. Required docs were updated for delivered features.
