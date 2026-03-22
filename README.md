# bff-mobile

Backend for Frontend para la aplicacion mobile de AxiomNode.

## Objetivo

- Adaptar contratos de backend a necesidades de mobile.
- Orquestar llamadas hacia microservicios internos mediante api-gateway.
- Reducir complejidad y latencia percibida en clientes mobile.

## Estructura

- `src/`: servicio Fastify + TypeScript.
- `docs/`: arquitectura, guias y operacion.
- `.github/workflows/ci.yml`: pipeline base.

## Inicio rapido

1. `cd src`
2. `cp .env.example .env`
3. `npm install`
4. `npm run dev`
