# bff-mobile

Backend for Frontend for the AxiomNode mobile application.

## Purpose

- Adapt backend contracts to mobile needs.
- Orchestrate calls to internal microservices via api-gateway.
- Reduce complexity and perceived latency on mobile clients.

## Main responsibility

- Optimized facade for mobile clients with compact payloads, low latency, and resilience.

## Structure

- `src/`: Fastify + TypeScript service.
- `docs/`: architecture, guides, and operations.
- `.github/workflows/ci.yml`: base pipeline.

## Quick start

1. `cd src`
2. `cp .env.example .env`
3. From the private `secrets` repository, run `node scripts/prepare-runtime-secrets.mjs dev` to generate `src/.env.secrets`
4. `npm install`
5. `npm run dev`

## Endpoints

- `GET /health`
- `GET /v1/mobile/games/quiz/random`
- `GET /v1/mobile/games/wordpass/random`
- `POST /v1/mobile/games/quiz/generate`
- `POST /v1/mobile/games/wordpass/generate`

## Internal dependencies

- `QUIZZ_SERVICE_URL`
- `WORDPASS_SERVICE_URL`
