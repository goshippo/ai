# Copyright 2026 Shippo
#
# Licensed under the MIT License. See the repository LICENSE file.

"""Runnable demo: a chosen Shippo rate becomes the AP2 shipping line.

Run it:

    python3 demo.py

It loads sample_rate.json (a realistic Shippo Rate object), converts it into
each AP2 shipping shape, and prints where each piece lands inside a Cart Mandate
and a Checkout Mandate. No network, no credentials, no third-party packages.

The point the output makes concrete: AP2 receives a money amount and a label.
It does not receive, and cannot recompute, the carrier / service / rating that
produced that amount. That context stays in the Shippo rate.
"""

from __future__ import annotations

import json
import pathlib

import shippo_ap2_shipping as conv

HERE = pathlib.Path(__file__).parent


def main() -> None:
    rate = json.loads((HERE / "sample_rate.json").read_text())

    print("Chosen Shippo rate (source of truth):")
    print(f"  object_id      {rate['object_id']}")
    print(f"  provider       {rate['provider']}")
    print(f"  servicelevel   {rate['servicelevel']['name']}")
    print(f"  amount         {rate['amount']} {rate['currency']}")
    print(f"  estimated_days {rate['estimated_days']}")
    print()

    shipping_option = conv.rate_to_payment_shipping_option(rate, selected=True)
    fulfillment_total = conv.rate_to_fulfillment_total(rate)

    print("=" * 70)
    print("A) Classic Cart Mandate (W3C Payment Request shape)")
    print("   Goes in: CartContents.payment_request.details.shipping_options[]")
    print("   The merchant signs CartContents; merchant_authorization (a JWT")
    print("   over cart_hash) freezes this exact figure.")
    print("=" * 70)
    print(json.dumps(shipping_option, indent=2))
    print()

    print("=" * 70)
    print("B) Newer Checkout Mandate (SD-JWT, vct mandate.checkout.1)")
    print("   Goes in: Checkout.totals[] and each LineItem.totals[]")
    print("   amount is a signed integer in minor units (cents here).")
    print("   The merchant signs the checkout payload; checkout_hash freezes it.")
    print("=" * 70)
    print(json.dumps(fulfillment_total, indent=2))
    print()

    print("What AP2 did NOT receive: no carrier code, no service token, no")
    print("transit-days field, no parcel dimensions, no tracking slot. Shippo")
    print(f"computed {rate['amount']} {rate['currency']}; AP2 guarantees it.")


if __name__ == "__main__":
    main()
