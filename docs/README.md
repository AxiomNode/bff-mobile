# bff-mobile docs

Last updated: 2026-05-03.

Technical documentation for the mobile BFF service.

## Purpose

This local docs folder explains the concrete implementation surface of `bff-mobile`:

- mobile-channel orchestration responsibilities
- downstream dependency model toward game services
- local operational workflow for app-facing integration changes

## Navigation

- `architecture/README.md`: repository-local architecture boundary and dependency model.
- `guides/README.md`: mobile integration and endpoint evolution guidance.
- `operations/README.md`: local runbook and operational notes.

## Reading order

1. Start with `architecture/README.md`.
2. Continue with `guides/README.md` when changing mobile-facing behavior.
3. Use `operations/README.md` for local run and troubleshooting.

## When to use this

- when the central platform docs are too broad for a mobile BFF change
- when you need the repository-local navigation entry for architecture, guides, and operations

## CI/CD reference

- Repository workflow: `.github/workflows/ci.yml`.
- Push to `main` dispatches `platform-infra` image build for `bff-mobile`.
