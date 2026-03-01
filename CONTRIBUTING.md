# Contributing

## Contribution principles

- Keep scope minimal and registry-focused.
- Do not add framework starter code.
- Preserve planning-first project initialization behavior.

## Required checks before merge

1. Every new asset path is explicitly added to `manifest.json`.
2. No wildcards in manifest entries.
3. `/app` placement rule remains explicit in documentation.
4. Agent and skill instructions remain deterministic and auditable.

## Pull request expectations

- Describe what changed and why.
- Include any manifest updates.
- Confirm no extra scaffold variants were added.

## Versioning

Update `manifest.json` version only when published registry contents change.
