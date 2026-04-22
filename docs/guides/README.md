# Guides

## Scope

This section groups repository-local guidance for evolving `bff-mobile` safely.

## Change rules

- add behavior here only when it is truly mobile-channel specific
- keep payloads compact and stable for app consumers
- prefer downstream contract adaptation over introducing new mobile-only domain semantics

## Intended topics

- mobile-client integration expectations
- endpoint versioning and compatibility rules
- safe downstream contract changes toward game services

## Compatibility checklist

Before changing a mobile-facing endpoint, verify:

1. whether the change is channel-specific or belongs in a downstream service
2. whether existing mobile clients can tolerate the new shape
3. whether the timeout profile remains appropriate for generation flows
4. whether category/language behavior still matches shared SDK expectations
