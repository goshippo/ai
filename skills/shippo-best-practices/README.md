# shippo-best-practices

*Editing this skill? Edit [`SKILL.md`](SKILL.md): that's the contract the assistant loads. This README is human-facing orientation only; don't duplicate canonical facts here.*

The decision-router for Shippo integrations. This skill maps a use case (checkout rates, single label, bulk fulfillment, tracking, address validation, customs) to the right Shippo primitive, Rates at Checkout vs. Shipments+Transactions vs. Batches, then enforces the cross-cutting rules that catch most integration bugs: validate addresses before purchase, parcel dimensions and weight as strings (not numbers), explicit purchase confirmation before `CreateTransaction`, and never truncating S3 signed label URLs. It also covers the Speakeasy response envelope and the 7-day rate expiry. Use it as the entry point before diving into a workflow-specific skill.

## When to use

- Planning a new Shippo integration and need to know which API to use
- Reviewing an existing integration for compliance with the critical rules (addresses, parcel types, purchase confirmation)
- Onboarding a new developer to Shippo's API surface area
- Deciding between Rates at Checkout, Shipments+Transactions, and Batches for a given workflow
- Setting up webhook subscriptions for the first time

## When NOT to use

- You already know exactly which workflow you need, go straight to the specific skill (`rate-shopping`, `label-purchase`, `batch-shipping`, etc.)
- You're debugging a specific API error, see `shippo/references/error-reference.md`
- You're migrating from an older Shippo API version, use `upgrade-shippo`

## Example prompts

- "I'm building a checkout flow with shipping, where do I start?"
- "What's the right Shippo API for bulk label generation from a CSV?"
- "What are the must-follow rules before purchasing a label?"
- "Review my Shippo integration for anything that violates best practices."
- "Which Shippo primitive should I use for international shipments with customs?"

## Related skills

- Workflow-specific: [`address-validation`](../address-validation/), [`rate-shopping`](../rate-shopping/), [`label-purchase`](../label-purchase/), [`tracking`](../tracking/), [`batch-shipping`](../batch-shipping/), [`shipping-analysis`](../shipping-analysis/): pick one after this skill routes you
- Migration: [`upgrade-shippo`](../upgrade-shippo/): moving an existing integration to the latest API version
- Shared references: [`../shippo/references/`](../shippo/): `response-envelope.md`, `error-reference.md`, `customs-guide.md`, `address-formats.md`, etc.
