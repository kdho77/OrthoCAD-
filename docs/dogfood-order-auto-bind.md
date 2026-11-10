# Dogfood order auto-bind

First sight of a vo2 dogfood order binds that order to the person returned by the existing order-owner verifier. The intake link is `POST /api/integrations/v1/designs` for a vo2 dogfood pair insole. The first CAD read is `GET /api/integrations/v1/designs` (`list_designs_by_order`) when that order has no design yet. Both call `autoBindDogfoodOrder`. Caller client ids, external client ids, and names do not establish identity.

`create_saved_design` is unchanged. Chart `givenName` and `familyName` on that call still label a new client after the same verifier accepts.

## Environment flags

Names only. No values belong in this note.

- `ORTHOCAD_DOGFOOD_ORDER_OWNER_VERIFY` — must be `on` or the bind is refused
- `ORTHOCAD_DOGFOOD_ORDER_OWNER_ORIGIN` — HTTPS origin, no path, user, or query
- `ORTHOCAD_DOGFOOD_ORDER_OWNER_BEARER` — dedicated server credential

The gate stays off until those are set. Unconfigured and rejected verifications write no rows. With the gate off, design create and an empty design list keep their current behavior.

## Idempotency

A verified person id that already has an `integration_clients` row reuses that client. The order link is inserted in the same transaction as a missing client, then retried once on a unique conflict. The existing unique keys are `(source, tenantId, externalClientId)` and `(source, tenantId, externalOrderId)`. No migration is added.

Absent width is `medium` with source `defaulted` on the new integration rows. `""` is not written to `shoeWidth`.

## New-client names (VertexOrders producer)

The verify 200 body has no person name. `interpretOrderOwnerResponse` requires the exact success keys and sets both names to null. An extra key is `verifier_untrusted`, which would also break `create_saved_design`.

VertexOrders2-0 (not this repo) needs to add these fields to `POST /api/integrations/orthocad/v1/order-owner/verify` 200, taken from the verified person record:

- `given_name`
- `family_name`

Do not send them until this consumer allows exactly those two optional keys. Until then, auto-bind creates a link only for a person already stored on `integration_clients` under the verified person id. A person with no row is `verifier_incomplete` and writes nothing.
