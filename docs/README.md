# bff-mobile docs

Technical documentation for the mobile BFF service.

## Sections

- `architecture/README.md`: architecture scope and dependencies.
- `guides/README.md`: mobile integration and endpoint versioning.
- `operations/README.md`: local runbook and secret injection flow.

## CI/CD reference

- Repository workflow: `.github/workflows/ci.yml`.
- Push to `main` dispatches `platform-infra` image build for `bff-mobile`.
