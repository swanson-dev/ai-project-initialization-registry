# Product Type Pack: ecommerce

Use this pack when the generated project is an ecommerce product.

## Ecommerce deliverables checklist

- Product catalog browsing (list, detail)
- Search and filtering
- Cart management (add/update/remove)
- Checkout flow (shipping, payment, confirmation)
- Order confirmation + basic order history
- Error/empty/loading states for all core flows

## Required docs list

- `/docs/01-requirements/ecommerce-requirements.md`
- `/docs/02-architecture/ecommerce-architecture.md`
- `/docs/03-ui-ux/ecommerce-ui-spec.md`
- `/docs/03-ui-ux/ecommerce-ui-approval.md`
- `/docs/06-decisions/ecommerce-key-decisions.md`
- `/docs/07-status/ecommerce-delivery-status.md`
- `/docs/08-testing-quality/ecommerce-test-strategy.md`

## Extra guardrails

- Never implement payment provider logic without explicit PCI/security notes in architecture docs.
- Do not expose secrets or payment tokens in client-side code.
- Inventory and pricing rules must be documented before checkout implementation.
- Checkout UI changes require mockups + recorded approval before coding.
- Keep all implementation code in `/app` only.
