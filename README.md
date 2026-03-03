# @codebasedesigns/project-os

CLI to initialize documentation-first projects from the project initialization registry.

## Build

```bash
npm install
npm run build
```

## Run locally

```bash
npm link
project-os init --ref main
```

## Commands

### `project-os init`

Initializes a project from the registry contract.

### `project-os doctor`

Read-only verification against `.project/selected-assets.json`.

### `project-os freeze`

Re-baselines `outputs.hashes` in `.project/selected-assets.json` against current disk state.

### `project-os reconcile`

Repairs provenance-managed copied files and instantiated docs back to registry/provenance truth.

## Examples

```bash
project-os init --ref main
project-os doctor
project-os doctor --hash
project-os freeze
project-os freeze --yes
project-os reconcile
project-os reconcile --yes
project-os reconcile --strict --delete-extra --yes
```

## Command semantics

- `doctor`: read-only verification
- `freeze`: accept current disk state as the new hash baseline
- `reconcile`: restore provenance-managed files back to registry/provenance truth

## Safety notes

- `freeze` only mutates `.project/selected-assets.json`
- `reconcile` is dry-run by default
- `reconcile` does not repair user-authored or unreconstructable files such as `README.md`, `.env.init`, `.gitignore`, `.project/bootstrap.lock`, or `.project/project.config.json`
- `doctor --hash` requires `outputs.hashes` in `.project/selected-assets.json`

## Exit behavior

- `doctor`: `0` clean, `1` drift, `2` error
- `freeze`: `0` dry-run success or updated, `2` error
- `reconcile`: `0` clean or reconciled, `1` dry-run drift, `2` error
