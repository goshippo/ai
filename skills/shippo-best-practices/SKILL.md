---
name: shippo-best-practices
description: >-
  Guides Shippo integration decisions, choosing between Rates at Checkout
  vs. full Shipments+Transactions vs. Batch processing, address validation
  strategy (v1 vs v2 fields), domestic vs international workflows (customs
  declarations, incoterms), label format selection, and webhook setup. Use when planning, building, or reviewing
  any Shippo integration, including building checkout flows, bulk
  fulfillment pipelines, address validation, label generation, package
  tracking, customs handling, or webhook subscriptions.
---

Latest Shippo API version: **2018-02-08**. Send via the `Shippo-API-Version` header.

## Using the Shippo MCP

The hosted Shippo MCP at `https://mcp.shippo.com` exposes exactly **4 tools** (a meta-API), not the underlying operations directly:

- `shippo_list_tools`: discover which operation you need.
- `shippo_describe_tool`: get that operation's input schema.
- `shippo_read_execute_tool`: run a read (lists, gets, lookups).
- `shippo_write_execute_tool`: run a write or mutation (creates, purchases, voids).

Every operation name in this skill (`ValidateAddress`, `CreateShipment`, `CreateTransaction`, `GetTrack`, etc.) is invoked **through** these wrappers, never called as a tool on its own. Standard discovery pattern: `shippo_list_tools` to find the operation, then `shippo_describe_tool` for its schema, then `shippo_read_execute_tool` or `shippo_write_execute_tool` to run it. The read/write split lets approval policies gate mutations separately. In the Claude apps these 4 tools may be deferred (loaded on demand), so an initial "tool has not been loaded yet" is normal: discover via the wrappers rather than guessing operation names.

## Integration routing

| Building…                                          | Recommended primitive          | See                                                                                        |
|----------------------------------------------------|--------------------------------|--------------------------------------------------------------------------------------------|
| Checkout flow with live shipping rates             | Rates at Checkout              | Rate Shopping (+ `shippo/references/rate-shopping-guide.md`)                               |
| Single label purchase                              | Shipments + Transactions       | Label Purchase                                                                              |
| Bulk label generation from CSV                     | Batches + Manifests            | Batch Shipping (+ `shippo/references/csv-format.md`)                                        |
| Track packages across carriers                     | Tracking + webhooks            | Tracking                                                                                    |
| Validate user addresses before save                | Addresses v2                   | Address Validation (+ `shippo/references/address-formats.md`)                               |
| Analyze shipping spend / optimize carriers         | Shipments + Transactions list  | Shipping Analysis                                                                           |
| International shipments                            | Customs Items + Declarations   | Label Purchase (+ `shippo/references/customs-guide.md` + `shippo/references/international-shipping.md`) |

Read the relevant skill or reference before answering integration questions or writing code.

## Critical rules

- **Always validate addresses before purchasing labels.** Most "no rates" / "label failed" errors trace back to unvalidated addresses.
- **Label purchases charge your live Shippo account for real.** Always confirm carrier, service, and cost with the user before any purchase.
- **Always confirm purchase before `CreateTransaction`.** Show carrier/service/cost/eta and require explicit user confirmation.
- **Parcel dimensions and weight must be strings, not numbers.** Use `"10"`, never `10`.
- **Label URLs are S3 signed URLs.** Always display the complete URL, truncating breaks the signature.
- **Rates expire after 7 days.** Re-create the shipment for fresh rates.
- **By-id parameter names are case-sensitive** (mostly PascalCase: `ShipmentId`, `TransactionId`, `OrderId`). Use the exact name from `shippo_describe_tool`; do not guess snake_case.
- **Never retry a 403/404 tool error with the same arguments.** Ownership and not-found errors are permanent for those inputs; verify the ID via the matching `List*` operation first. The generic `An internal error occurred. Please retry later.` relay most often traces to an input issue too, so verify inputs before retrying, and retry the identical call at most once.

## Response handling

The MCP wraps responses in a Speakeasy envelope. Some failures bypass the envelope. See `shippo/references/response-envelope.md` and `shippo/references/error-reference.md` for parsing logic and error-handling patterns.

## Connecting

The hosted MCP at `https://mcp.shippo.com` uses per-user Shippo OAuth. You authorize once through Shippo (in Claude Code, run `/mcp` and sign in), and the session refreshes automatically. There is nothing to copy or configure. Once you are connected, the workflow guidance below is unchanged.

- **Two 401 strings to recognize:**
  - `"Token does not exist"`: the credential is invalid, revoked, or for a different account. Re-authorize the Shippo OAuth session.
  - `"Authentication credentials were not provided"`: no credential reached Shippo. The OAuth session is not authorized yet, or it has expired. Re-authorize the Shippo OAuth session.

## Purchases are live

Label and batch purchases charge the authorized Shippo account for real money. Before any `CreateTransaction` or `PurchaseBatch`, show the carrier, service level, cost, and ETA, and get explicit user confirmation. Do not proceed without it.

## Key documentation

- [API Concepts](https://docs.goshippo.com/docs/api_concepts/apiversioning): request shapes, versioning, auth
- [Address Validation Guide](https://docs.goshippo.com/docs/addresses/address_validation): validation depth varies by country
- [Customs Reference](https://docs.goshippo.com/docs/exporting/internationalshipments): incoterms, contents types, HS codes
- [Carrier Accounts](https://docs.goshippo.com/docs/shipping/carrieraccounts): managed vs custom accounts
- [Webhooks](https://docs.goshippo.com/docs/tracking/webhooks): event types, signature verification

(Once Mintlify migration completes, `.md` URL suffixes will provide raw markdown access for AI agents.)
