---
name: address-validation
description: Validate, parse, and standardize shipping addresses via the Shippo API
---
<!--
  ⚠️  DO NOT EDIT. Auto-generated from skills/address-validation/SKILL.md by scripts/sync.js
  Edits here will be overwritten on the next sync.
  To change this content, edit the canonical source and re-run the sync script.
-->


# Address Validation

## Address Field Format

The Shippo API uses **v1 field names** for address components in most endpoints (including `CreateShipment`). Always use:

| Field | Description | Example |
|---|---|---|
| `name` | Full name | `Jane Smith` |
| `street1` | Street address line 1 | `731 Market St` |
| `street2` | Street address line 2 (optional) | `Suite 200` |
| `city` | City | `San Francisco` |
| `state` | State or province | `CA` |
| `zip` | Postal code | `94103` |
| `country` | ISO 3166-1 alpha-2 country code | `US` |
| `email` | Email (required for international senders) | `jane@example.com` |
| `phone` | Phone (required for international senders) | `+1-555-123-4567` |

Note: `CreateAddress` and `ValidateAddress` take the v2 field names (`address_line_1`, `city_locality`, `state_province`, `postal_code`), but when passing addresses inline to `CreateShipment`, you must use the v1 names above.

---

## Validate a Structured Address

1. Collect at minimum: `street1`, `city`, `state`, `zip`, `country` (ISO 3166-1 alpha-2).
2. Call `CreateAddress` with the address fields. This creates the address and returns an object ID.
3. Call `ValidateAddress` with the address fields to get validation results. Note: this endpoint takes address fields as query parameters, not an object ID.
4. Check `analysis.validation_result.value` in the response. Values: `"valid"`, `"invalid"`, or `"partially_valid"` (address found with corrections applied). Check `analysis.validation_result.reasons` for details.
5. Report the standardized address back. Highlight any corrected fields (listed in `changed_attributes`). Note `analysis.address_type` (`"residential"`, `"commercial"`, or `"unknown"`) -- residential classification affects carrier surcharges.
6. If invalid: relay the reason descriptions. If the API returns a `recommended_address`, present it to the user.
7. If `partially_valid`: show what was corrected and ask the user to confirm the corrections are acceptable.

---

## Parse a Freeform Address

1. Call `ParseAddress` with the raw string (e.g., "123 Main St, Springfield IL 62704").
2. Review the structured output for completeness. The parse response uses v2 field names: `address_line_1`, `city_locality`, `state_province`, `postal_code`.
3. Note: the parse response does not include `country`. You must ask the user for the country or infer it, then add it before proceeding.
4. Validate the parsed result by passing the fields to `CreateAddress` then `ValidateAddress` (follow the structured address workflow above from step 2).

---

## International Addresses

- Always require the `country` field. Do not guess.
- Pass non-Latin characters as-is; the API handles encoding.
- Validation depth varies by country. US, CA, GB, AU, and major EU countries have deep validation. Others may only confirm structural completeness. Inform the user of this limitation.

---

## Bulk Address Validation

There is no batch validation endpoint. Call `CreateAddress` per address. Track results (row number, valid/invalid, corrections, errors, residential classification) and report a summary when done. For 50+ addresses, set expectations about processing time and provide progress updates.

---

## Re-validate an Existing Address

Call `ValidateAddress` with the address fields. This endpoint validates by address fields, not by object ID.

---

## Duplicate Addresses

If `CreateAddress` returns a "Duplicate address" error, the address already exists in the account. Retrieve it via `ListAddresses` or proceed directly to validation.

---

## Quick Reference

**Validate an address:**
`CreateAddress` (saves address) + `ValidateAddress` (validates with same fields)

**Parse then validate:**
`ParseAddress` -> add country -> `CreateAddress` + `ValidateAddress`
