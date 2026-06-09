<!--
  ⚠️  DO NOT EDIT. Auto-generated from skills/address-validation/README.md by scripts/sync.js
  Edits here will be overwritten on the next sync.
  To change this content, edit the canonical source and re-run the sync script.
-->

# address-validation

*Editing this skill? Edit [`SKILL.md`](SKILL.md): that's the contract the assistant loads. This README is human-facing orientation only; don't duplicate canonical facts here.*

Validate, parse, and standardize shipping addresses via the Shippo API. Structured addresses go through `CreateAddress` + `ValidateAddress`, with results read from `analysis.validation_result.value` (`valid`, `invalid`, `partially_valid`) and corrections surfaced via `changed_attributes`. Freeform strings are handled by `ParseAddress`, which returns v2 field names (`address_line_1`, `city_locality`, `state_province`, `postal_code`) but no `country`: the skill prompts for or infers it before validating. International coverage is broad but uneven: US, CA, GB, AU, and major EU countries get deep validation; others may only confirm structural completeness. There is no batch endpoint, so bulk validation iterates one address at a time.

## When to use

- User wants to validate a shipping address before saving it
- Parsing an address from freeform text input
- Standardizing an address with corrections (`changed_attributes`)
- Determining whether an address is residential vs commercial (affects surcharges)

## When NOT to use

- You're getting rates or buying a label, those workflows already validate inline (see `rate-shopping`, `label-purchase`)
- You need bulk address scrubbing across millions of records, Shippo has no batch endpoint, this skill iterates one-at-a-time

## Example prompts

- "Validate this address: 350 Fifth Ave, New York, NY 10118"
- "Parse this freeform address: '1 Hacker Way Menlo Park CA 94025'"
- "Is this address residential or commercial?"
- "Standardize this customer address before saving."

## Related

- `rate-shopping` and `label-purchase` validate inline, call this skill explicitly only when validation is the user's primary goal
- `shippo/references/address-formats.md` for v1 vs v2 field naming
