# Project Initialization Registry

Project Initialization Registry is a documentation-first registry consumed by a future initializer (`npx` bootstrap tool) through `manifest.json`.

## What this repository contains

This repository is **not** a framework starter template. It is a registry of reusable initialization assets:

- Project scaffolds (planning + code structure)
- File templates (consistent report structures)
- Agent packs (rules + instructions)
- Skills (reusable behaviors)
- Tech stack recipes (guardrails only, not scaffolds)

## Core rule: where code goes

All generated projects are planning + code. 

- **All implementation code must live under `/app`.**
- **Everything else at repository root is documentation + governance.**

## MVP scope (Phase 1)

This MVP includes:

- One scaffold (`standard-planning-plus-code`)
- One core agent pack (`core`)
- Five skills
- Two tech stack recipes (`nextjs`, `go`)
- Explicit `manifest.json` path mappings

## How this repo is consumed

A future initializer reads `manifest.json` and copies referenced assets into a new project workspace. This registry keeps initialization rules centralized and versioned.

## Quick navigation

- Usage: `USAGE.md`
- Contributing: `CONTRIBUTING.md`
- Manifest schema notes: `manifest-schema.md`
- Scaffold: `scaffolds/standard-planning-plus-code/`
