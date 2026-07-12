# Copyright 2026 Shippo
#
# Licensed under the MIT License. See the repository LICENSE file.
#
# Reference helper: turn a chosen Shippo rate into the shipping line that an
# AP2 Cart Mandate / Checkout Mandate freezes. See README.md for the full
# integration guide and primary-source citations.

"""Shippo rate -> AP2 mandate shipping line.

Shippo computes the shipping figure. AP2 then locks it: the merchant signs the
cart (Cart Mandate) or the checkout payload (Checkout Mandate), and the buyer
approves that exact frozen amount. AP2 does not compute or recompute shipping.
It carries a money amount plus a human-readable label and guarantees them.

This helper produces both shapes AP2 currently defines for that line, using the
exact field names from the AP2 SDK (see citations in the README):

  1. PaymentShippingOption  -- the W3C Payment Request shape used by the
     classic Cart Mandate (ap2.models.payment_request.PaymentShippingOption).
  2. Total{type: "fulfillment"} -- the pricing-breakdown entry used by the
     newer SD-JWT Checkout Mandate (ap2.sdk.generated.types.total.Total).

Neither shape has a carrier code, service token, transit-days number, package
dimensions, or tracking slot. AP2's shipping line is a money amount plus a
free-text label. Anything a merchant wants to reason about later (which carrier,
which service, how it was rated) stays on the Shippo side. That asymmetry is the
whole point of this helper: keep the Shippo rate as the source of truth and emit
only what AP2 will actually sign.

No third-party dependencies. Input is a plain dict shaped like a Shippo Rate
object; output is plain dicts you can drop straight into the AP2 SDK models or
serialize to JSON.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from typing import Any

# ISO 4217 currencies with no minor unit (amount is already in whole units).
# Used only by the Checkout Mandate path, whose Total.amount is an integer in
# minor units. Extend this set if you rate in another zero-decimal currency.
_ZERO_DECIMAL_CURRENCIES = frozenset(
    {"JPY", "KRW", "VND", "CLP", "ISK", "HUF", "UGX", "XAF", "XOF", "XPF"}
)

# Number of minor units per major unit for the few three-decimal currencies.
_THREE_DECIMAL_CURRENCIES = frozenset({"BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"})


def _minor_unit_exponent(currency: str) -> int:
    """Return the ISO 4217 minor-unit exponent for a currency code."""
    code = currency.upper()
    if code in _ZERO_DECIMAL_CURRENCIES:
        return 0
    if code in _THREE_DECIMAL_CURRENCIES:
        return 3
    return 2


def shipping_label(rate: dict[str, Any]) -> str:
    """Build the human-readable shipping label AP2 stores verbatim.

    Example: "USPS Priority Mail (2-3 business days)".

    AP2's label fields (PaymentShippingOption.label, Total.display_text) are
    free text shown to the buyer at approval time. This is the one place the
    carrier and service survive into the mandate, and only as prose, so make it
    unambiguous. The number is authoritative; the label is what the buyer reads.
    """
    provider = str(rate.get("provider") or "").strip()
    service = (rate.get("servicelevel") or {}).get("name")
    service = str(service or "").strip()

    name = " ".join(part for part in (provider, service) if part)
    if not name:
        name = "Shipping"

    days = rate.get("estimated_days")
    if isinstance(days, int) and days > 0:
        unit = "business day" if days == 1 else "business days"
        return f"{name} ({days} {unit})"
    return name


def _currency_amount(rate: dict[str, Any]) -> dict[str, Any]:
    """PaymentCurrencyAmount: {"currency": str, "value": float}.

    Mirrors ap2.models.payment_request.PaymentCurrencyAmount. Shippo returns
    ``amount`` as a decimal string (e.g. "12.50"); AP2 models ``value`` as a
    float. We parse via Decimal to avoid a binary-float surprise, then hand AP2
    the float it asks for.
    """
    currency = str(rate["currency"]).upper()
    value = float(Decimal(str(rate["amount"])))
    return {"currency": currency, "value": value}


def _minor_units(rate: dict[str, Any]) -> int:
    """Integer amount in the currency's minor unit (e.g. cents).

    The Checkout Mandate's Total.amount is a signed integer in minor units.
    """
    currency = str(rate["currency"]).upper()
    exponent = _minor_unit_exponent(currency)
    scaled = Decimal(str(rate["amount"])) * (Decimal(10) ** exponent)
    return int(scaled.quantize(Decimal(1), rounding=ROUND_HALF_UP))


def rate_to_payment_shipping_option(
    rate: dict[str, Any], *, selected: bool = False
) -> dict[str, Any]:
    """Shippo rate -> AP2 PaymentShippingOption (classic Cart Mandate).

    Shape (ap2.models.payment_request.PaymentShippingOption):
        {"id": str, "label": str, "amount": PaymentCurrencyAmount,
         "selected": bool}

    ``id`` is the Shippo rate ``object_id`` so the merchant can tie the frozen
    option back to the exact rate it signed (and later buy that label). AP2
    itself treats ``id`` as an opaque string; it does not parse it.
    """
    return {
        "id": str(rate["object_id"]),
        "label": shipping_label(rate),
        "amount": _currency_amount(rate),
        "selected": bool(selected),
    }


def rate_to_payment_item(
    rate: dict[str, Any], *, pending: bool = False
) -> dict[str, Any]:
    """Shippo rate -> AP2 PaymentItem for the cart's display_items line.

    Shape (ap2.models.payment_request.PaymentItem):
        {"label": str, "amount": PaymentCurrencyAmount, "pending": bool}

    Use this when you want shipping to appear as its own line in the cart
    breakdown the buyer sees, in addition to (or instead of) a shipping option.
    AP2 fills ``refund_period`` with its own default (30 days); we do not emit
    it here because Shippo does not supply a shipping-line refund window.
    """
    return {
        "label": shipping_label(rate),
        "amount": _currency_amount(rate),
        "pending": bool(pending),
    }


def rate_to_fulfillment_total(rate: dict[str, Any]) -> dict[str, Any]:
    """Shippo rate -> AP2 Checkout Mandate Total{type: "fulfillment"}.

    Shape (ap2.sdk.generated.types.total.Total):
        {"type": "fulfillment", "display_text": str, "amount": int}

    ``amount`` is a signed integer in minor currency units (e.g. cents), per the
    generated Total schema. ``type`` is the fixed cost-category token
    "fulfillment" that the schema lists for shipping/delivery. The currency is
    not on the Total itself; it lives once on the enclosing Checkout object.
    """
    return {
        "type": "fulfillment",
        "display_text": shipping_label(rate),
        "amount": _minor_units(rate),
    }


def rate_to_ap2_shipping(
    rate: dict[str, Any], *, selected: bool = False
) -> dict[str, Any]:
    """Emit every AP2 shipping shape for one chosen Shippo rate.

    Convenience wrapper so a caller can produce all representations at once and
    pick the one their AP2 flow needs. Nothing here recomputes the figure; every
    field derives from the single rate the merchant already chose.
    """
    return {
        "payment_shipping_option": rate_to_payment_shipping_option(
            rate, selected=selected
        ),
        "payment_item": rate_to_payment_item(rate),
        "fulfillment_total": rate_to_fulfillment_total(rate),
    }
