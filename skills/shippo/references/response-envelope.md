# Response Envelope

Reference for the Speakeasy wrapper structure that the Shippo MCP places around API responses. This envelope shape applies to the hosted Shippo MCP at https://mcp.shippo.com.

## Envelope shape

Most successful and 4xx responses come wrapped in:

```json
{
  "ContentType": "application/json",
  "StatusCode": <code>,
  "RawResponse": {},
  "<PayloadName>": { ...actual response... }
}
```

The payload field is named after the response schema on success, for example `ParsedAddress`, `AddressPaginatedList`, `AddressValidationResultV2`, `AddressWithMetadataResponse`, `Shipment`, `CarrierAccountPaginatedList`. On some errors the payload is named after the HTTP status code instead (e.g. `fourHundredAndNineApplicationJsonObject` for a 409, the body may be `{}`).

## Extracting the payload

Find the field whose key is NOT one of `ContentType`, `StatusCode`, `RawResponse`. That is the payload. Branch on `StatusCode` for success vs. error.

## When the envelope is bypassed

Some failures bypass the envelope entirely and surface as MCP-protocol-level errors instead. See [error-reference.md](error-reference.md#non-envelope-mcp-protocol-errors) for handling.
