# bff-mobile

Backend for Frontend para la aplicacion mobile de AxiomNode.

## Objetivo

- Adaptar contratos de backend a necesidades de mobile.
- Orquestar llamadas hacia microservicios internos mediante api-gateway.
- Reducir complejidad y latencia percibida en clientes mobile.

## Responsabilidad principal

- Fachada optimizada para clientes moviles con payloads compactos, baja latencia y resiliencia.

## Estructura

- `src/`: servicio Fastify + TypeScript.
- `docs/`: arquitectura, guias y operacion.
- `.github/workflows/ci.yml`: pipeline base.

## Inicio rapido

1. `cd src`
2. `cp .env.example .env`
3. Desde el repositorio privado `secrets`, ejecutar `node scripts/prepare-runtime-secrets.mjs dev` para generar `src/.env.secrets`
4. `npm install`
5. `npm run dev`

## Endpoints

- `GET /health`
- `GET /v1/mobile/games/quiz/random`
- `GET /v1/mobile/games/wordpass/random`
- `POST /v1/mobile/games/quiz/generate`
- `POST /v1/mobile/games/wordpass/generate`

## Dependencias internas

- `QUIZZ_SERVICE_URL`
- `WORDPASS_SERVICE_URL`
