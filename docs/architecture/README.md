# Architecture

## Scope

This section documents the repository-local architecture of `bff-mobile`.

It should describe:

- endpoint facade responsibilities for mobile clients
- response composition focused on mobile UX requirements
- primary integration with `api-gateway` and internal game services

## Runtime position

`bff-mobile` is the channel adapter for the mobile client surface.

It sits behind `api-gateway` and in front of game-oriented domain services. It should shield the app from internal route churn and service topology changes.

## Owned architectural responsibilities

- expose mobile-shaped response contracts
- orchestrate quiz and word-pass reads and generation requests
- translate downstream service failures into channel-appropriate responses
- avoid owning persistence or operator-managed runtime state

## Downstream dependency model

Primary direct dependencies:

- `microservice-quizz`
- `microservice-wordpass`

Indirect dependencies reached through those services:

- `ai-engine-api`
- `ai-engine-stats`

## Architectural constraints

- no BFF-to-BFF calls
- no browser- or operator-shared state persisted here
- no direct domain logic duplication that belongs in the game services

## Request flow summary

1. `api-gateway` forwards mobile request to `bff-mobile`
2. `bff-mobile` selects downstream game service
3. service response is normalized for mobile consumption
4. BFF returns stable app-facing payload shape

## Failure boundaries

- downstream game service unavailable or slow
- response cannot be adapted safely to the mobile contract
- latency inherited from AI-backed generation path downstream

## When to update

Update this section when changing channel orchestration, downstream dependency shape, or app-facing contract boundaries.
