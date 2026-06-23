# Carrier tokens

Shippo's `GetTrack` operation takes a **carrier token** in its `Carrier` argument: a
normalized lowercase string, **not** a display name. Passing a display name (or the
wrong token) returns an error. This file maps names to tokens and gives format
heuristics for inferring the carrier when the user only provides a number.

> The authoritative, current list lives in Shippo's carrier docs at
> `https://docs.goshippo.com`. Treat this table as a fast-path; if a token here
> fails, confirm against the docs.

## Name to token

| Display name | Token | Notes |
|---|---|---|
| USPS | `usps` | US domestic + international. Populates `location` (city/state/zip) on most scans. |
| UPS | `ups` | |
| FedEx | `fedex` | |
| DHL Express | `dhl_express` | International express. |
| DHL eCommerce | `dhl_ecommerce` | |
| Canada Post | `canada_post` | |
| **Evri** (formerly **Hermes UK**) | **`hermes_uk`** | See gotcha below. Scans carry **no** per-event coordinates. |
| Asendia US | `asendia_us` | |
| Sendle | `sendle` | |
| LaserShip / OnTrac | `lasership` | |
| Australia Post | `australia_post` | |
| DPD | `dpd` | |
| Royal Mail | `royal_mail` | |
| GLS | `gls` | |

## Known gotcha: Evri

Evri rebranded from Hermes UK, but **Shippo's token is still `hermes_uk`**. Passing
`evri` returns an internal server error. Always use `hermes_uk` for Evri tracking
numbers (they often start with `H`).

## Inferring the carrier from the number format

Use these only when the user didn't give a carrier. They're heuristics, not
guarantees: if the inference matters and is uncertain, **ask the user** rather than
guessing across many carriers.

| Pattern | Likely carrier | Token |
|---|---|---|
| 22 or 26 digits starting `9261 / 9270 / 9400 / 9205 / 93 / 94 / 95` | USPS (Intelligent Mail package barcode) | `usps` |
| `1Z` + 16 chars (18 total) | UPS | `ups` |
| 12 or 15 digits | FedEx | `fedex` |
| Starts with `H`, UK destination | Evri | `hermes_uk` |
| `JD` + long numeric | DHL eCommerce | `dhl_ecommerce` |
| 10 digits, DHL Express air waybill | DHL Express | `dhl_express` |

## Fallback procedure

1. If a carrier name is given, map it via the table above.
2. Else infer from format. If confident, use that token.
3. If `GetTrack` errors on the chosen token, try the documented alternate
   (e.g. `evri` to `hermes_uk`) before giving up.
4. If still unresolved, ask the user which carrier the number belongs to. Don't
   brute-force every token.

## Extending this file

When you encounter a new carrier/token pairing (or a new number-format signature),
add a row here so the skill gets better over time. Keep tokens lowercase and exactly
as Shippo returns them in `ListCarrierAccounts[].carrier` or accepts in `GetTrack`.
