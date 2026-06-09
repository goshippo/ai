# rate-shopping

*Editing this skill? Edit [`SKILL.md`](SKILL.md): that's the contract the assistant loads. This README is human-facing orientation only; don't duplicate canonical facts here.*

Compare shipping rates across USPS, UPS, FedEx, DHL, and 30+ carriers, then surface the cheapest, fastest, or best-value option for a route.

Rates come from `CreateShipment` (origin, destination, parcel, all dimension and weight values must be **strings**, e.g. `"10"` not `10`), or from `CreateLiveRate` when you have `line_items` instead of a packed parcel. The skill covers dimensional-weight math (USPS divisor 166; UPS, FedEx, DHL divisor 139), the flat-rate vs. custom-dimensions decision, and speed filtering ("overnight" = `estimated_days` 1, "2-day" = `<= 2`, "within N days" = `<= N`).

Cheapest, fastest, and best-value are **computed** by sorting the `rates` array yourself, they are not API-returned fields. State the trade-off when recommending. Rates expire 7 days after retrieval; create a new shipment for fresh quotes.

## When to use

- "Display rates at checkout to a customer"
- "Find the cheapest carrier for a route"
- "Compare carriers and service levels for an upcoming shipment"
- "Calculate dimensional weight for a large lightweight package"

## When NOT to use

- You're ready to buy, `label-purchase` covers rate selection plus the transaction together.
- You need persistent rate quotes longer than 7 days, quotes expire; create a new shipment for fresh rates.
- You need rates for 100+ shipments, use `batch-shipping`, which has rate shopping built in.

## Example prompts

- "Compare shipping rates for a 2lb package from San Francisco to New York"
- "What's the cheapest USPS rate to Chicago for an envelope?"
- "Get me FedEx rates for an international shipment to London"
- "Show me overnight options for shipping a small box to LA"

## Related skills

- `address-validation`: validate origin and destination before quoting (most common cause of empty rate arrays).
- `label-purchase`: buy a selected rate and produce a label.
- `batch-shipping`: bulk rate shopping over a CSV of shipments.
- `shippo/references/rate-shopping-guide.md`: dimensional weight examples and the flat-rate vs. custom-dimensions decision tree.
