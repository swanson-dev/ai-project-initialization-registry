# manifest.json schema notes (MVP)

This document describes the minimal shape of `manifest.json` used in Phase 1.

## Top-level fields

- `version` (string): semantic version for registry snapshot.
- `published_at` (string): ISO-8601 timestamp for publication.
- `scaffolds` (array): scaffold records.
- `agent_packs` (array): agent pack records.
- `skills` (array): skill records.
- `tech_stack_recipes` (array): tech recipe records.
- `file_templates` (array): template records.

## Record shape

Each record uses:

- `id` (string): stable identifier.
- `path` (string): explicit relative path to directory or file.

## Constraints

- No wildcard paths in MVP.
- Every referenced path MUST exist.
- MVP includes one scaffold only (`standard-planning-plus-code`).
