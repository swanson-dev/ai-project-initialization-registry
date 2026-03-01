# Usage

## Purpose

Use this registry as the source of truth for initializing new projects with planning-first structure and strict placement rules.

## Consumption model

1. Read `manifest.json`.
2. Resolve each listed path.
3. Copy selected assets into the target repository.
4. Enforce agent-pack and tech-stack guardrails.

## Registry rules

- Use exactly the assets referenced by `manifest.json`.
- Do not infer wildcard files in MVP.
- Keep code inside `/app` for generated projects.

## Typical initializer flow (future)

- Select scaffold (`standard-planning-plus-code`)
- Add core agent pack
- Attach selected skills
- Apply one tech stack recipe
- Materialize relevant file templates

## Validation checks

- Every manifest path exists.
- Only one scaffold is published in MVP.
- `/app` code-only rule appears in scaffold + agent pack + recipes.
