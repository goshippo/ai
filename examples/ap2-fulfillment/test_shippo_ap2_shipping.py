# Copyright 2026 Shippo
#
# Licensed under the MIT License. See the repository LICENSE file.

"""Tests for the Shippo-rate to AP2-shipping helper.

Stdlib unittest only: run with ``python3 -m unittest`` or ``python3
test_shippo_ap2_shipping.py``. These assert the exact AP2 field names and the
money/minor-unit conversions, so a drift in either side surfaces here.
"""

from __future__ import annotations

import json
import pathlib
import unittest

import shippo_ap2_shipping as conv

HERE = pathlib.Path(__file__).parent

USD_RATE = {
    "object_id": "545ab0a1b4a3457eb920c4934d3e2f8f",
    "amount": "12.50",
    "currency": "USD",
    "provider": "USPS",
    "servicelevel": {"name": "Priority Mail", "token": "usps_priority"},
    "estimated_days": 2,
}


class ShippingLabelTests(unittest.TestCase):
    def test_provider_service_and_days(self):
        self.assertEqual(
            conv.shipping_label(USD_RATE), "USPS Priority Mail (2 business days)"
        )

    def test_singular_day(self):
        rate = dict(USD_RATE, estimated_days=1)
        self.assertEqual(
            conv.shipping_label(rate), "USPS Priority Mail (1 business day)"
        )

    def test_missing_days_omits_parenthetical(self):
        rate = dict(USD_RATE)
        rate.pop("estimated_days")
        self.assertEqual(conv.shipping_label(rate), "USPS Priority Mail")

    def test_missing_everything_falls_back(self):
        self.assertEqual(conv.shipping_label({}), "Shipping")


class PaymentShippingOptionTests(unittest.TestCase):
    def test_exact_shape_and_fields(self):
        opt = conv.rate_to_payment_shipping_option(USD_RATE, selected=True)
        self.assertEqual(
            set(opt), {"id", "label", "amount", "selected"}
        )  # PaymentShippingOption
        self.assertEqual(opt["id"], USD_RATE["object_id"])
        self.assertEqual(opt["label"], "USPS Priority Mail (2 business days)")
        self.assertEqual(opt["amount"], {"currency": "USD", "value": 12.5})
        self.assertIs(opt["selected"], True)

    def test_selected_defaults_false(self):
        opt = conv.rate_to_payment_shipping_option(USD_RATE)
        self.assertIs(opt["selected"], False)


class PaymentItemTests(unittest.TestCase):
    def test_exact_shape_and_fields(self):
        item = conv.rate_to_payment_item(USD_RATE)
        self.assertEqual(set(item), {"label", "amount", "pending"})  # PaymentItem
        self.assertEqual(item["amount"], {"currency": "USD", "value": 12.5})
        self.assertIs(item["pending"], False)


class FulfillmentTotalTests(unittest.TestCase):
    def test_exact_shape_and_minor_units(self):
        total = conv.rate_to_fulfillment_total(USD_RATE)
        self.assertEqual(set(total), {"type", "display_text", "amount"})  # Total
        self.assertEqual(total["type"], "fulfillment")
        self.assertEqual(total["display_text"], "USPS Priority Mail (2 business days)")
        self.assertEqual(total["amount"], 1250)
        self.assertIsInstance(total["amount"], int)

    def test_rounding_half_up(self):
        rate = dict(USD_RATE, amount="12.505")
        self.assertEqual(conv.rate_to_fulfillment_total(rate)["amount"], 1251)

    def test_zero_decimal_currency(self):
        rate = dict(USD_RATE, amount="800", currency="JPY")
        self.assertEqual(conv.rate_to_fulfillment_total(rate)["amount"], 800)

    def test_three_decimal_currency(self):
        rate = dict(USD_RATE, amount="1.250", currency="KWD")
        self.assertEqual(conv.rate_to_fulfillment_total(rate)["amount"], 1250)


class CurrencyAmountTests(unittest.TestCase):
    def test_value_is_float_from_string(self):
        amount = conv.rate_to_payment_item(USD_RATE)["amount"]
        self.assertIsInstance(amount["value"], float)
        self.assertEqual(amount["value"], 12.5)

    def test_currency_uppercased(self):
        rate = dict(USD_RATE, currency="usd")
        self.assertEqual(
            conv.rate_to_payment_item(rate)["amount"]["currency"], "USD"
        )


class BundleTests(unittest.TestCase):
    def test_bundle_contains_all_shapes(self):
        bundle = conv.rate_to_ap2_shipping(USD_RATE, selected=True)
        self.assertEqual(
            set(bundle),
            {"payment_shipping_option", "payment_item", "fulfillment_total"},
        )
        self.assertIs(bundle["payment_shipping_option"]["selected"], True)


class SampleFixtureTests(unittest.TestCase):
    def test_sample_rate_json_round_trips(self):
        rate = json.loads((HERE / "sample_rate.json").read_text())
        opt = conv.rate_to_payment_shipping_option(rate)
        self.assertEqual(opt["amount"], {"currency": "USD", "value": 12.5})
        self.assertEqual(conv.rate_to_fulfillment_total(rate)["amount"], 1250)


if __name__ == "__main__":
    unittest.main(verbosity=2)
