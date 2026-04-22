# Operations

## Scope

This section groups repository-local operational notes for `bff-mobile`.

## Local run

1. `cd src`
2. `cp .env.example .env`
3. From the private `secrets` repository, run `node scripts/prepare-runtime-secrets.mjs dev` to generate `src/.env.secrets`
4. `npm install`
5. `npm run dev`

## Operational checks

After startup, validate:

- `GET /health`
- quiz random flow through the BFF
- word-pass random flow through the BFF
- at least one generation path when downstream AI is expected to be reachable

## Common failure patterns

- BFF healthy but downstream game service unavailable
- generation latency dominated by downstream AI runtime rather than BFF logic
- environment variables point to wrong internal service hostnames or ports

## Troubleshooting rule

When a mobile route fails, first determine whether the fault is:

1. edge-to-BFF forwarding
2. BFF-to-service connectivity
3. downstream service validation or persistence
4. downstream AI capacity or reachability
