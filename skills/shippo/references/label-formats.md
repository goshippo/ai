# Label Formats

Supported label file types, when to use each, and label URL handling.

---

## Supported Formats

| Format | Dimensions | Use Case |
|---|---|---|
| `PDF_4x6` | 4" x 6" | **Default.** Standard thermal label. Works with all carriers. |
| `PDF_4x8` | 4" x 8" | Extended label for UPS/FedEx when extra info is needed |
| `PDF_A4` | 8.27" x 11.69" | Standard office printer (A4 paper) |
| `PDF_A5` | 5.83" x 8.27" | Half-sheet label on A5 paper |
| `PDF_A6` | 4.13" x 5.83" | Quarter-sheet label on A6 paper |
| `PDF` | Varies | Generic PDF, carrier-determined size |
| `PDF_2.3x7.5` | 2.3" x 7.5" | Narrow format for specific label printers |
| `PNG` | Varies | Image format, good for web display or integration |
| `PNG_2.3x7.5` | 2.3" x 7.5" | Narrow PNG format |
| `ZPLII` | N/A | Zebra Programming Language for thermal Zebra printers |

---

## Choosing a Format

- **Thermal label printer (Zebra, Dymo, etc.):** Use `PDF_4x6` or `ZPLII`. ZPLII prints fastest on Zebra printers but requires ZPL-compatible hardware.
- **Standard office/inkjet/laser printer:** Use `PDF_A4` (the label prints on a full sheet that can be cut or used with adhesive label stock).
- **Integration / programmatic use:** Use `PNG` for embedding in web pages or apps.
- **Batch printing:** Use `PDF_4x6` for consistency. Batch purchase responses include individual label URLs per shipment.

When in doubt, use `PDF_4x6` -- it is the most universally compatible format.

---

## Setting the Label Format

### Single label (transactions-create)
Pass `label_file_type` when purchasing:
```json
{
  "rate": "rate_abc123",
  "label_file_type": "PDF_4x6"
}
```

### Batch labels (batches-create)
Pass `label_filetype` at the batch level (note: no underscore between "file" and "type"):
```json
{
  "default_carrier_account": "...",
  "default_servicelevel_token": "...",
  "label_filetype": "PDF_4x6",
  "batch_shipments": [...]
}
```

---

## Label URL Handling

- Label URLs are **S3 signed URLs** with long query strings. They are temporary but valid for an extended period.
- **Always display the complete URL** without truncation. Truncating the URL will break the signature and the link will not work.
- The URL is returned in the `label_url` field of the transaction response (after status is `SUCCESS`).
- For batches, each batch shipment result contains its own `label_url` after batch purchase is complete.

---

## Notes

- Not all carriers support all formats. If you request an unsupported format, Shippo will fall back to a supported one (usually PDF_4x6).
- ZPLII is only useful for Zebra thermal printers. Do not use it unless the user specifically requests ZPL output.
- Label URLs should be accessed promptly. While they remain valid for a long time, it is best practice to download or display them soon after purchase.
