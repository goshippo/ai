<!--
  ⚠️  DO NOT EDIT. Auto-generated from skills/shippo/references/error-reference.md by scripts/sync.js
  Edits here will be overwritten on the next sync.
  To change this content, edit the canonical source and re-run the sync script.
-->

# Error Reference

Common Shippo API errors, their causes, and recovery steps.

---

## Address Validation Failures

### Invalid street address
- **Pattern:** `"Street address is invalid"` or validation result `is_valid: false`
- **Cause:** Street name/number not found in carrier database, typo, or nonexistent address.
- **Recovery:** Ask the user to double-check the street address. Try `ParseAddress` if they have a freeform string. Check for common issues: missing directional prefix (N, S, E, W), missing street suffix (St, Ave, Blvd), or transposed numbers.

### Missing or invalid postal code
- **Pattern:** `"Invalid ZIP/postal code"` or `"ZIP code does not match state"`
- **Cause:** ZIP code is wrong, missing, or does not match the city/state combination.
- **Recovery:** Verify the ZIP code matches the city and state. For US addresses, ensure 5-digit or ZIP+4 format.

### PO Box restrictions
- **Pattern:** `"PO Box not allowed for this service"` or no rates returned for PO Box addresses
- **Cause:** UPS and FedEx do not deliver to PO Boxes. Only USPS serves PO Boxes.
- **Recovery:** If the destination is a PO Box, use USPS. Otherwise, ask the user for a street address.

### Missing apartment/unit number
- **Pattern:** Validation returns suggestions with `"Apt"` or `"Unit"` appended
- **Cause:** The address is a multi-unit building and the unit number was not provided.
- **Recovery:** Ask the user for the apartment, suite, or unit number. Include it in `street2`.

---

## No Rates Returned

### Address not validated
- **Pattern:** `CreateShipment` returns empty `rates` array
- **Cause:** One or both addresses failed validation. Carriers will not return rates for unverifiable addresses.
- **Recovery:** Validate both `address_from` and `address_to` using `CreateAddress` before creating the shipment. Check validation messages.

### Unsupported route
- **Pattern:** Empty rates or `"No rates available for this lane"`
- **Cause:** The carrier does not service the origin-destination pair (e.g., USPS does not ship between two non-US countries).
- **Recovery:** Try different carriers. Check `ListCarrierAccounts` to see which carriers are configured. For international routes, DHL Express often has the broadest coverage.

### Parcel too large or too heavy
- **Pattern:** `"Package exceeds maximum dimensions"` or `"Package exceeds maximum weight"`
- **Cause:** The parcel dimensions or weight exceed carrier limits.
- **Recovery:** Check carrier weight limits (USPS: 70 lbs, UPS/FedEx: 150 lbs). Consider splitting into multiple packages or using freight services.

### Carrier not configured for route
- **Pattern:** Rates returned for some carriers but not others
- **Cause:** The carrier account is not enabled for the origin country or does not support the service level for that route.
- **Recovery:** Check carrier account configuration. The user may need to enable international shipping or add a carrier account in the Shippo dashboard.

---

## Label Purchase Errors

### Rate expired
- **Pattern:** `"Rate has expired"` or `"Rate is no longer valid"`
- **Cause:** Rates expire after 7 days. The user waited too long between getting rates and purchasing.
- **Recovery:** Create a new shipment to get fresh rates, then purchase immediately.

### Address mismatch
- **Pattern:** `"Address validation failed"` at purchase time
- **Cause:** The carrier revalidates addresses at purchase time and found a discrepancy.
- **Recovery:** Validate addresses again using `CreateAddress`, fix any issues, create a new shipment.

### Missing customs declaration for international
- **Pattern:** `"Customs declaration required"` or `"International shipments require customs information"`
- **Cause:** The shipment crosses borders but no customs declaration was attached.
- **Recovery:** Create customs items and a customs declaration, then create a new shipment with the `customs_declaration` field.

### Insufficient funds / billing issue
- **Pattern:** `"Insufficient funds"` or `"Payment method required"`
- **Cause:** The Shippo account does not have a valid payment method or has exhausted its balance.
- **Recovery:** Direct the user to add or update their payment method in the Shippo dashboard.

---

## Batch Errors

### Invalid address in batch
- **Pattern:** Batch status `INVALID` with per-shipment errors showing address issues
- **Cause:** One or more shipments in the batch have invalid addresses.
- **Recovery:** Call `GetBatch` to identify which shipments failed. Fix the addresses and either update the batch or create a new one with corrected data.

### Missing required fields
- **Pattern:** `"Missing required field"` on batch creation
- **Cause:** Batch shipment objects are missing required fields (address, parcels, etc.).
- **Recovery:** Verify each shipment in the batch has `address_from`, `address_to`, and `parcels`. For international shipments, ensure `customs_declaration` is included.

### Batch already purchased
- **Pattern:** `"Batch has already been purchased"` or `"Cannot modify a purchased batch"`
- **Cause:** Attempting to add/remove shipments or re-purchase an already purchased batch.
- **Recovery:** Create a new batch for additional shipments.

---

## Tracking Errors

### Invalid tracking number format
- **Pattern:** `"Invalid tracking number"` or `"Tracking number not found"`
- **Cause:** The tracking number format does not match the carrier's expected format, or the number is wrong.
- **Recovery:** Verify the tracking number format matches the carrier:
  - USPS: 20-22 digits or starts with 9 + 20 digits
  - UPS: starts with `1Z` + 16 alphanumeric
  - FedEx: 12 or 15 digits
  - DHL Express: 10 digits

### Carrier mismatch
- **Pattern:** `"Tracking information not available"` with valid-looking tracking number
- **Cause:** The `carrier` parameter does not match the actual carrier for the tracking number.
- **Recovery:** Verify the carrier token is correct. Common mix-ups: `dhl_express` vs `dhl_ecommerce`, `usps` vs `ups`.

---

## Rate Limit and Auth Errors

### Rate limited
- **Pattern:** HTTP 429 or `"Rate limit exceeded"`
- **Cause:** Too many API requests in a short period.
- **Recovery:** The MCP server handles retries automatically. If the user is processing a large batch, this is expected. Wait and retry.

### Authentication failure
- **Pattern:** HTTP 401, `"Invalid API token"`, `"Token does not exist"`, or `"Authentication credentials were not provided"`.
- **Cause:** No valid OAuth token reached Shippo. Either the Shippo MCP OAuth session has not been authorized yet, or the token has expired or been revoked.
- **Recovery:** Re-authorize the Shippo MCP OAuth session. In Claude Code, run `/mcp` and sign in. Confirm the authorized account has access to the resource.

### Object not found
- **Pattern:** A valid-looking object ID returns a not-found error.
- **Cause:** The object does not exist on the authorized account, or it belongs to a different account.
- **Recovery:** Confirm you are signed in to the account that owns the object.

---

## General Rules

- **Never guess** parcel dimensions, weight, customs values, HS codes, or signer names. Always ask the user.
- **Do not auto-retry** transport, auth, or rate-limit errors. Report the error to the user and stop.

---

## General Debugging Steps

1. **Check the full error response.** Shippo error messages are usually descriptive. Read the `detail` or `messages` field.
2. **Validate addresses first.** Most shipment and label errors trace back to address issues.
3. **Check object status.** For async operations, always poll until the final status before proceeding.
4. **Verify the account.** A "not found" usually means the object lives on a different account; confirm you are signed in to the owning account.
5. **Check carrier account.** Ensure the carrier is configured and enabled for the desired route.

---

## Non-envelope MCP-protocol errors

Some failures bypass the Speakeasy [response envelope](response-envelope.md) entirely and surface as MCP-protocol-level errors instead. Two flavors:

### Tool-result errors (`isError: true`)

The MCP tool response has `isError: true` with a single text block containing a plaintext message:

```
Unexpected API response status or content-type:
Status 404 Content-Type application/json Body: {"detail":"Not found."}
```

These typically indicate the upstream Shippo API returned an unexpected shape (e.g. a 404 on a tracking lookup the SDK didn't anticipate). Report the plaintext body to the user verbatim, it carries the actual error detail.

### Argument-validation errors (JSON-RPC `-32602`)

Pre-call validation failures (missing required field, type mismatch) return JSON-RPC error code `-32602` ("Invalid params") with a `message` field describing the failure. These are MCP-client-side; correct the arguments and retry.

### Handling both paths

When reporting errors:

1. Check for `isError: true` on the tool result first.
2. If absent, check `StatusCode` inside the envelope.
3. If JSON-RPC `-32602` is returned, the call never reached Shippo, it's an arg-shape problem, not an API problem.
