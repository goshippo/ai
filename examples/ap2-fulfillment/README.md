# Shippo shipping for AP2 mandates

A reference adapter for putting a Shippo shipping rate into a Google
[Agent Payments Protocol (AP2)](https://github.com/google-agentic-commerce/AP2)
mandate: the Cart Mandate and the newer Checkout Mandate.

The headline, stated plainly up front so nothing here oversells the protocol:

> **Shippo computes the shipping figure. AP2 freezes it.**
> AP2's mandate does not model or recompute shipping. It carries a money amount
> plus a human-readable label, and it cryptographically guarantees that the
> buyer approved exactly that amount. This helper produces that one line from a
> rate you already chose with Shippo.

If you came here expecting a rich "shipping object" converter (carrier codes,
service tokens, transit windows, parcel dimensions), read the
[What AP2's shipping slot actually is](#what-ap2s-shipping-slot-actually-is)
section first. That object does not exist in AP2, by design, and this reference
does not invent one.

## What's in here

| File | Purpose |
|---|---|
| `shippo_ap2_shipping.py` | The helper. Pure stdlib. Turns a Shippo rate dict into each AP2 shipping shape. |
| `demo.py` | `python3 demo.py` -- loads `sample_rate.json`, prints where each shape lands in a mandate. |
| `test_shippo_ap2_shipping.py` | `python3 -m unittest` -- asserts exact AP2 field names and the money/minor-unit math. |
| `sample_rate.json` | A realistic Shippo Rate object used by the demo and one test. |

No install step, no dependencies, no network, no credentials. Python 3.10+.

```bash
cd examples/ap2-fulfillment
python3 demo.py
python3 -m unittest -v
```

## What AP2's shipping slot actually is

AP2 represents an agent purchase as signed **mandates**. Two of them carry a
cart, and this is where a shipping charge appears. AP2 currently defines that
charge in two shapes, and this helper emits both.

### Shape A: the classic Cart Mandate (W3C Payment Request)

`CartMandate` wraps a `CartContents`, and `CartContents.payment_request` is a
[W3C Payment Request](https://www.w3.org/TR/payment-request/) object that AP2
re-uses verbatim (the SDK module says so in its own docstring). Shipping lives
in `PaymentDetailsInit.shipping_options`, a list of `PaymentShippingOption`:

```python
class PaymentShippingOption(BaseModel):
    id: str        # "A unique identifier for the shipping option."
    label: str     # "A human-readable description of the shipping option."
    amount: PaymentCurrencyAmount   # {currency: str, value: float}
    selected: bool | None
```

That is the entire shipping schema: an opaque `id`, a free-text `label`, and an
`amount`. There is no carrier field, no service level, no transit-days number,
no dimensions. The merchant signs `CartContents`, and
`CartMandate.merchant_authorization` is a JWT over a `cart_hash` (a hash of the
canonical JSON of `CartContents`). That signature is the freeze.

### Shape B: the newer Checkout Mandate (SD-JWT)

The newer `CheckoutMandate` (`vct: mandate.checkout.1`) is an SD-JWT over a
merchant-signed checkout payload, frozen by a `checkout_hash`. Its pricing lives
in a `totals` breakdown of `Total` entries:

```python
class Total(BaseModel):
    type: str             # "subtotal, discount, items_discount, fulfillment, tax, fee, total"
    display_text: str | None
    amount: int           # "Signed amount in minor currency units."
```

Shipping is the entry with `type: "fulfillment"`: a category token, an optional
free-text `display_text`, and an integer amount in minor units. Same story, even
thinner. The spec's own worked example goes further and carries shipping as a
bare string field `"shipping_policy": "Standard Shipping"` alongside a single
`total_price` (see the primary source below). There is no structured shipping
object anywhere in the Checkout Mandate.

### Why it is shaped this way

AP2's job is buyer authorization, not fulfillment. The mandate answers "did the
human agree to pay this exact total, including this shipping amount, with this
label shown to them?" To answer that it only needs the number and the words the
buyer saw. Everything about *how* that number was produced (which carrier, which
service, how it was rated, what the parcel was) stays with the rating system.
Here that is Shippo. So the honest integration is not a schema translation. It
is: pick a Shippo rate, hand AP2 the amount plus a clear label, and let AP2's
signature guarantee it.

## How to use it

```python
import json
import shippo_ap2_shipping as conv

# `rate` is one entry from a Shippo Shipment's `rates` array (the one the buyer
# or your agent chose). See the Rate Shopping skill in this repo.
rate = json.loads(open("sample_rate.json").read())

# For a classic Cart Mandate: drop into
# CartContents.payment_request.details.shipping_options[]
option = conv.rate_to_payment_shipping_option(rate, selected=True)

# Optionally also show shipping as its own cart line:
# CartContents.payment_request.details.display_items[]
line = conv.rate_to_payment_item(rate)

# For a Checkout Mandate: drop into Checkout.totals[] and each LineItem.totals[]
total = conv.rate_to_fulfillment_total(rate)

# Or get all three at once:
everything = conv.rate_to_ap2_shipping(rate, selected=True)
```

The outputs are plain dicts using AP2's exact field names, so they serialize
straight to the JSON the AP2 SDK models expect. What you do next belongs to AP2,
not to Shippo: assemble the rest of the cart, then sign it (the merchant JWT for
a Cart Mandate, or the checkout payload signature for a Checkout Mandate). Use
the AP2 SDK for the signing and hashing; this helper deliberately stops at the
shipping line so it never has to reimplement AP2's cryptography.

### The `id` round-trip

For the Cart Mandate, `PaymentShippingOption.id` is set to the Shippo rate's
`object_id`. AP2 treats it as opaque, but you get a useful property for free:
after the buyer approves the mandate, that same `object_id` is what you pass to
Shippo to actually buy the label. The frozen shipping line and the purchasable
rate stay tied together without inventing a field AP2 does not have.

## Caveats and honest edges

- **This is not a schema converter, because there is no rich schema to convert
  to.** AP2's shipping is an amount plus a label. If a future AP2 version adds a
  structured shipping object, this helper would grow real field mappings; today
  it correctly does not.
- **The label is the only place carrier/service survive**, and only as prose.
  `shipping_label()` builds `"USPS Priority Mail (2 business days)"` from the
  rate's `provider`, `servicelevel.name`, and `estimated_days`. Keep it
  unambiguous: it is what the buyer reads and what the signature commits to.
- **Minor-unit conversion covers common currencies.** The Checkout Mandate's
  integer `Total.amount` needs minor units. The helper handles 2-decimal
  currencies (default), zero-decimal (JPY, KRW, ...), and 3-decimal (KWD, ...)
  via ISO 4217 exponents. If you rate in a currency outside those sets, add it
  to the tables in `shippo_ap2_shipping.py`. The classic Cart Mandate path uses
  a float `value` and sidesteps this entirely.
- **Signing, hashing, and expiry are AP2's job, not this helper's.** The
  `merchant_authorization` JWT, the `cart_hash` / `checkout_hash`, and the short
  mandate expiry windows all come from the AP2 SDK. This reference only builds
  the shipping line that goes inside what AP2 signs.
- **AP2 is young and has two live cart shapes.** The classic W3C-based Cart
  Mandate and the SD-JWT Checkout Mandate coexist in the current repo. This
  helper supports both rather than betting on one. Field names are pinned to the
  AP2 `main` branch as cited below; re-check them if you target a tagged release.

## Primary sources

All field names above are taken directly from the AP2 repository, not from
secondary write-ups.

- Cart Mandate, CartContents, `merchant_authorization`, `cart_hash`:
  [`code/sdk/python/ap2/models/mandate.py`](https://github.com/google-agentic-commerce/AP2/blob/main/code/sdk/python/ap2/models/mandate.py)
- `PaymentShippingOption`, `PaymentItem`, `PaymentCurrencyAmount`,
  `PaymentDetailsInit`, `PaymentOptions`:
  [`code/sdk/python/ap2/models/payment_request.py`](https://github.com/google-agentic-commerce/AP2/blob/main/code/sdk/python/ap2/models/payment_request.py)
- Checkout Mandate (`vct: mandate.checkout.1`), `checkout_hash`:
  [`code/sdk/python/ap2/sdk/generated/checkout_mandate.py`](https://github.com/google-agentic-commerce/AP2/blob/main/code/sdk/python/ap2/sdk/generated/checkout_mandate.py)
- `Total` (`type: "fulfillment"`, integer minor-unit `amount`) and the
  `shipping_policy` / `total_price` worked example:
  [`code/sdk/python/ap2/sdk/generated/types/total.py`](https://github.com/google-agentic-commerce/AP2/blob/main/code/sdk/python/ap2/sdk/generated/types/total.py)
  and [`docs/ap2/checkout_mandate.md`](https://github.com/google-agentic-commerce/AP2/blob/main/docs/ap2/checkout_mandate.md)
- Underlying W3C shipping definitions AP2 re-uses:
  [W3C Payment Request API](https://www.w3.org/TR/payment-request/#dom-paymentshippingoption)
- Protocol overview: [ap2-protocol.org](https://ap2-protocol.org/)

The Shippo rate fields consumed here (`object_id`, `amount`, `currency`,
`provider`, `servicelevel.name`, `estimated_days`) are the same ones the
[Rate Shopping](../../skills/rate-shopping/SKILL.md) skill in this repo works
with.
