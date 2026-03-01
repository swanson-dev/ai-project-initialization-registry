# OUTPUT_RULES (Authoritative)

This is the single source of truth for output placement and delivery workflow.

## 1) File placement + no-code-outside-`/app`

- All implementation code MUST be created under `/app` only.
- Agents MUST NOT create or modify implementation code outside `/app`.
- Root-level files and `/docs` are documentation/governance only.
- If a task requests code outside `/app`, agents MUST refuse and propose a compliant path.

## 2) Documentation placement rules

Planning and governance artifacts belong in `/docs` by topic:

- `/docs/00-overview`: project context and summary
- `/docs/01-requirements`: requirements and acceptance criteria
- `/docs/02-architecture`: architecture constraints and design
- `/docs/03-ui-ux`: mockups, UI specs, approval records
- `/docs/04-project-management`: plans and execution tracking
- `/docs/05-research`: findings and evaluations
- `/docs/06-decisions`: decision records (ADR-style)
- `/docs/07-status`: changelogs and status updates
- `/docs/08-testing-quality`: test and quality strategy/reports
- `/docs/09-release`: release readiness and rollout docs
- `/docs/10-implementation`: implementation plans and mappings

## 3) Naming conventions

- Use lowercase kebab-case for file names (`feature-name.md`).
- Keep folder numbering prefixes exactly as scaffolded (`00-` through `10-`).
- Prefer one canonical file per topic to avoid duplicate sources of truth.
- Use stable, descriptive names (for example: `checkout-flow-ui-spec.md`, `payments-adr.md`).

## 4) Required workflow: planning -> UI approval gate -> implementation

1. Plan first: produce task plan + impacted files before coding.
2. For UI-facing changes, create mockups/specs and an approval checklist in `/docs/03-ui-ux`.
3. Obtain explicit approval record before implementing UI.
4. Only then implement code in `/app`.

Agents MUST NOT start UI implementation before Step 3.

## 5) Feature -> docs update requirement

Any implemented or materially changed feature MUST update required documentation:

- Requirement changes -> `/docs/01-requirements`
- Architecture-impacting changes -> `/docs/02-architecture` and `/docs/06-decisions`
- Delivery/progress updates -> `/docs/07-status`

A feature is not complete until code + required docs are both updated.
