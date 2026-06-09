<!--
  ⚠️  DO NOT EDIT. Auto-generated from skills/shippo/references/address-formats.md by scripts/sync.js
  Edits here will be overwritten on the next sync.
  To change this content, edit the canonical source and re-run the sync script.
-->

# Address Formats

Shippo uses two address field naming conventions (v1 and v2) depending on the endpoint. This document clarifies which format to use where.

---

## V1 Field Names

Used by: `CreateShipment` (inline addresses), `CreateBatch`, `CreateAddress`, `CreateManifest`, `CreateOrder`

| Field | Required | Description |
|---|---|---|
| `name` | Yes | Full name |
| `company` | No | Company name |
| `street1` | Yes | Street address line 1 |
| `street2` | No | Apt, suite, unit, etc. |
| `street3` | No | Additional address line |
| `city` | Yes | City |
| `state` | Depends | State/province (required for US, CA, AU; optional for many other countries) |
| `zip` | Depends | Postal code (required for most countries; not used by some, e.g., IE, HK) |
| `country` | Yes | ISO 3166-1 alpha-2 country code |
| `phone` | No* | Phone number |
| `email` | No* | Email address |
| `is_residential` | No | Boolean, whether the address is residential |

*Phone and email are required for international shipments (carriers need them for customs processing).

### V1 Inline Address Example (for shipments-create)

```json
{
  "name": "Jane Smith",
  "street1": "731 Market St",
  "street2": "#200",
  "city": "San Francisco",
  "state": "CA",
  "zip": "94103",
  "country": "US",
  "email": "jane@example.com",
  "phone": "+1-555-123-4567"
}
```

---

## V2 Field Names

Used by: `CreateAddress`, `ValidateAddress`

Returned by: `ParseAddress`

| Field | Required | Description |
|---|---|---|
| `name` | Yes | Full name |
| `company` | No | Company name |
| `address_line_1` | Yes | Street address line 1 |
| `address_line_2` | No | Apt, suite, unit, etc. |
| `address_line_3` | No | Additional address line |
| `city_locality` | Yes | City |
| `state_province` | Depends | State/province |
| `postal_code` | Depends | Postal code |
| `country_code` | Yes | ISO 3166-1 alpha-2 country code |
| `phone` | No* | Phone number |
| `email` | No* | Email address |
| `is_residential` | No | Boolean |

### V2 Address Example (for addresses-create-v2)

```json
{
  "name": "Jane Smith",
  "address_line_1": "731 Market St",
  "address_line_2": "#200",
  "city_locality": "San Francisco",
  "state_province": "CA",
  "postal_code": "94103",
  "country_code": "US",
  "email": "jane@example.com",
  "phone": "+1-555-123-4567"
}
```

---

## Parse Response Format

`ParseAddress` returns v2 field names **without** `country_code` (the parser does not infer country). You must add the country yourself before passing to `CreateAddress` or converting to v1 for `CreateShipment`.

Example parse response fields:
```json
{
  "address_line_1": "731 Market St",
  "address_line_2": "#200",
  "city_locality": "San Francisco",
  "state_province": "CA",
  "postal_code": "94103"
}
```

---

## Converting Between V1 and V2

When you get a parse result (v2) and need to use it in `CreateShipment` (v1):

| V2 Field | V1 Field |
|---|---|
| `address_line_1` | `street1` |
| `address_line_2` | `street2` |
| `address_line_3` | `street3` |
| `city_locality` | `city` |
| `state_province` | `state` |
| `postal_code` | `zip` |
| `country_code` | `country` |

`name`, `company`, `phone`, `email`, and `is_residential` use the same field name in both versions.

---

## Country-Specific Address Notes

### State/Province
- **Required:** US, CA, AU, CN, IN, MX, BR
- **Optional/Unused:** Most European countries (FR, DE, IT, ES, NL, etc.), UK, JP, SG

### Postal Code
- **Formats vary by country:**
  - US: 5 digits or ZIP+4 (e.g., `94103` or `94103-1234`)
  - CA: A1A 1A1 (letter-digit-letter space digit-letter-digit)
  - UK: Complex format (e.g., `SW1A 2AA`, `EC1A 1BB`, `W1D 3QU`)
  - DE/FR/IT/ES: 5 digits
  - AU: 4 digits
  - JP: 7 digits with hyphen (e.g., `123-4567`)
- **Not used:** Some countries do not use postal codes (e.g., IE for older addresses, HK, AE). Omit the field rather than sending an empty string.

### Phone Numbers
- Include country code prefix for international shipments (e.g., `+1` for US, `+44` for UK, `+49` for DE).
- Required for international shipments by all major carriers.
