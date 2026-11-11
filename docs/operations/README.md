# Operations

Last updated: 2026-05-08.

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

## Client IP and rate limiting

- `TRUST_PROXY` (default `false`) controls how Fastify derives `request.ip`. Leave it `false` when the service is reached directly. Behind the ingress set it to the number of trusted proxy hops (for example `1`; it must match the real proxy chain, otherwise clients can spoof their address), `true` (trust every hop; only safe if the pod is unreachable except through the proxy), or a comma-separated list of proxy IPs/CIDRs (`loopback`, `linklocal` and `uniquelocal` are also accepted). Invalid values fail startup.
- With the default `false` behind an ingress, every client appears to come from the ingress address and shares one rate-limit bucket.
- All `/v1/mobile/*` routes pass through an in-memory fixed-window limiter keyed by `request.ip`: `RATE_LIMIT_MAX` requests (default `120`, `0` disables) per `RATE_LIMIT_WINDOW_MS` (default `60000`). Exceeding it returns `429` with `Retry-After` and `X-RateLimit-*` headers. `/health` and monitoring routes are not limited.
- The limiter state is per process: with N replicas the effective per-client budget is up to N times `RATE_LIMIT_MAX`.
