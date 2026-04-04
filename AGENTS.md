# AGENTS

## Repo purpose
Mobile BFF that serves mobile-optimized game APIs and orchestration.

## Key paths
- src/: Fastify code, integrations, validation
- docs/: architecture, guides, operations
- .github/workflows/ci.yml: CI + infra dispatch

## Local commands
- cd src && npm install
- cd src && npm run dev
- cd src && npm test && npm run lint && npm run build

## CI/CD notes
- Push to main dispatches platform-infra build-push with service=bff-mobile.
- Platform-infra deploy workflow applies rollout to dev.

## LLM editing rules
- Keep mobile payloads lean and stable.
- Preserve separation between quiz and wordpass flows.
- Update docs/contracts when request or response payloads change.
