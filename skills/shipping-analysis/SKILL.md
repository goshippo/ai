---
name: shipping-analysis
description: Analyze shipping costs, compare carriers, optimize package dimensions, and review historical shipping spend via the Shippo API
---

# Shipping Analysis and Optimization

## Geographic Cost Analysis

1. Confirm origin address, destination list (or use representative cities), and parcel details.
2. Call `ListCarrierAccounts` to see configured carriers.
3. Call `CreateShipment` per destination to collect rates. Creating shipments is free; only `CreateTransaction` costs money.
4. Write results to `analysis/` directory (markdown report + CSV). Columns: Route, Destination, Carrier, Service, Cost, Currency, EstimatedDays, Zone.

---

## Package Optimization

1. Confirm the route.
2. Define dimension profiles to test (or use user-provided ones).
3. Check `ListCarrierParcelTemplates` and `ListUserParcelTemplates` for flat-rate and saved templates. See `shippo/references/rate-shopping-guide.md` for dimensional weight and flat-rate guidance.
4. Call `CreateShipment` per profile on the same route.
5. Compare: cheapest rate, carrier options, fastest option per profile. Note where flat-rate templates beat custom dimensions and where dimensional weight causes price jumps. See `shippo/references/carrier-guide.md` for carrier-specific weight limits and surcharges.

---

## Carrier Comparison

1. Call `CreateShipment` for the route.
2. Group the `rates` array by `provider`.
3. Per carrier: cheapest service, fastest service, number of service levels, price range.

---

## Historical Cost Optimization

1. Call `ListShipments` and `ListTransactions` to get past activity.
2. Cross-reference: what the user paid vs. what alternatives were available.
3. Identify patterns: carrier concentration, service-level mismatch, consistent overpayment.
4. For a sample of shipments with tracking numbers, call `GetTrack` to check actual vs. estimated delivery times.
5. If fewer than 5 successful transactions exist (not just shipments -- shipments are rate quotes, transactions represent actual spend), redirect to forward-looking analysis.

---

## Output Conventions

Write reports to the `analysis/` directory. Create it if it does not exist. Include both markdown and CSV. CSV must have a header row. Markdown must include a timestamp and input parameters.

---

## Quick Reference

**Cost analysis:**
`ListCarrierAccounts` -> `CreateShipment` (per destination) -> read `rates` arrays -> write report

**Carrier comparison:**
`CreateShipment` -> group `rates` by `provider` -> summarize

**Historical review:**
`ListShipments` + `ListTransactions` -> cross-reference -> `GetTrack` (sample) -> write report
