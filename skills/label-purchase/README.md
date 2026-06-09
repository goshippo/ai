# label-purchase

*Editing this skill? Edit [`SKILL.md`](SKILL.md): that's the contract the assistant loads. This README is human-facing orientation only; don't duplicate canonical facts here.*

Purchase domestic and international shipping labels via the Shippo API. **Every call to `CreateTransaction` requires explicit user confirmation**: the skill summarizes carrier, service, cost, ETA, and origin/destination, then waits for an explicit go-ahead before charging. Domestic labels follow `CreateShipment` -> rate selection -> `CreateTransaction` -> status check (`SUCCESS`/`QUEUED`/`ERROR`). International labels add a customs leg up front (`CreateCustomsItem` per item, then `CreateCustomsDeclaration`, then a shipment with `customs_declaration` attached). Labels default to `PDF_4x6`; other formats (`PDF_A4`, `ZPLII` for Zebra printers, `PNG`, etc.) are selectable per purchase. Return labels reuse the same flow with `address_from` and `address_to` swapped, and labels are voided through `CreateRefund` (eligibility varies by carrier).

## When to use

- "Buy a label for a single shipment"
- "Generate an international label with customs"
- "Create a return label"
- "Void a previously-purchased label"
- "Set up a packing slip from an order"

## When NOT to use

- You only need to compare rates, use `rate-shopping`
- You're processing 100+ shipments at once, use `batch-shipping`
- You need an address validated only, use `address-validation`

## Example prompts

- "Buy a USPS Priority Mail label from 350 5th Ave NYC to 1 Hacker Way Menlo Park, 2lb package"
- "Ship 2 books worth $30 internationally from California to London"
- "Create a return label for tracking 9400111899223100001234"
- "Void this label: txn_abc123"
- "Create an order for 3 line items and print the packing slip after the label is purchased"

## Related

- `rate-shopping` to get rates first, but `CreateShipment` returns rates inline, so you may not need both
- `address-validation` for upstream address checks (label flows already validate inline)
- `tracking` once the label is purchased
- `shippo/references/customs-guide.md` for international shipments
- `shippo/references/label-formats.md` for format selection
