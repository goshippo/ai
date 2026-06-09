# International Shipping Guide

Country-specific requirements, duty/tax considerations, and international shipping best practices.

---

## General Requirements for All International Shipments

1. **Customs declaration required.** Attach via `customs_declaration` field on the shipment. See customs-guide.md for full details.
2. **Sender email and phone required.** All major carriers require these on `address_from` for customs processing.
3. **HS/tariff codes strongly recommended.** USPS requires them (6+ digits) as of September 2025. FedEx and DHL strongly recommend them.
4. **Commercial invoice auto-generated.** Shippo generates 3 copies automatically. The URL is in the transaction response.
5. **Declared values must be accurate.** Under-declaration is illegal and may result in fines, seizure, or shipment refusal.

---

## Country-Specific Requirements

### Canada

- **EEL/PFC:** Use `NOEEI_30_36` regardless of shipment value. The $2,500 threshold and `NOEEI_30_37_a` apply to non-Canada destinations only.
- **B13A filing:** Required for exports from Canada exceeding CAD $2,000. Set `b13a_filing_option` to `FILED_ELECTRONICALLY`, `SUMMARY_REPORTING`, or `NOT_REQUIRED` on the customs declaration.
- **De minimis:** CAD $20 for taxes, CAD $150 for duties on commercial goods. Shipments above these thresholds incur duties/taxes.
- **Prohibited items:** Cannabis (even if legal in origin country), certain weapons, obscene material.
- **State field:** Use 2-letter province codes (e.g., `ON`, `BC`, `QC`).

### European Union (EU)

- **VAT / IOSS:** As of July 2021, all goods imported into the EU are subject to VAT. For shipments valued under EUR 150, sellers can register for IOSS (Import One-Stop Shop) to pre-collect VAT at checkout. Include the IOSS number in the `exporter_reference` field on the customs declaration.
- **Without IOSS:** The carrier collects VAT from the recipient on delivery, which causes delivery delays and poor customer experience. DDP with IOSS is strongly preferred for B2C e-commerce.
- **De minimis:** EUR 150 for customs duties (below this, only VAT applies). No duty-free threshold for VAT (applies from EUR 0).
- **Country codes for EU members:** AT, BE, BG, HR, CY, CZ, DK, EE, FI, FR, DE, GR, HU, IE, IT, LV, LT, LU, MT, NL, PL, PT, RO, SK, SI, ES, SE.

### United Kingdom (Post-Brexit)

- **Separate customs territory** from the EU since January 2021. Shipments from the EU to the UK (and vice versa) require full customs declarations.
- **VAT:** 20% standard rate. For shipments valued under GBP 135, the seller must register for UK VAT and collect it at the point of sale. For shipments over GBP 135, VAT is collected at import.
- **De minimis:** GBP 135 for simplified VAT treatment. No duty-free threshold -- customs duties apply based on tariff classification.
- **EORI number:** UK importers need an EORI number. Include in `importer_reference` if the recipient provides one.

### Australia

- **GST:** 10% Goods and Services Tax on all imported goods regardless of value (since January 2018 for low-value goods under AUD 1,000).
- **Biosecurity restrictions:** Strict controls on food, plant material, animal products, soil, and wood packaging. Shipments with restricted items may be held, treated, or destroyed at the border. Warn users shipping any organic materials to Australia.
- **De minimis:** AUD 1,000 for customs duties (below this, only GST applies).
- **Postal code:** 4 digits. State codes: NSW, VIC, QLD, SA, WA, TAS, NT, ACT.

### Japan

- **Consumption tax:** 10% on most imported goods.
- **De minimis:** JPY 10,000 for duty and tax exemption on commercial goods.
- **Postal code:** 7 digits with hyphen (e.g., `123-4567`).
- **Address format:** Japanese addresses are written in reverse order compared to Western addresses. The API accepts Western-order input.

### China

- **Cross-border e-commerce tax:** Combined rate of approximately 9.1% on most consumer goods under CNY 5,000 per transaction.
- **Personal ID required:** Chinese customs may require the recipient's national ID number for clearance. Include in `importer_reference` if available.
- **State field:** Use province names (e.g., `Guangdong`, `Beijing`).

---

## Duty and Tax Considerations

### Incoterms

| Term | Who Pays Duties/Taxes | Notes |
|---|---|---|
| `DDU` | Recipient | Default for most B2C. Recipient pays on delivery. |
| `DDP` | Sender | Sender prepays all duties/taxes. Better customer experience. Not supported by USPS. |
| `DAP` | Recipient | Similar to DDU. Supported by DHL. |
| `FCA` | Varies | Seller delivers to carrier. B2B / drop-ship scenarios. |

### When to Use DDP
- B2C e-commerce where customer experience matters
- High-value shipments where surprise duties would cause refusals
- Markets where COD duty collection causes delivery failures (common in some EU countries)
- DDP requires the sender to have a tax registration in the destination country (or use a carrier's duty billing)

---

## Prohibited and Restricted Items (General)

These categories commonly face restrictions across multiple countries:

| Category | Notes |
|---|---|
| **Batteries / lithium cells** | Restricted as dangerous goods. Some carriers allow with proper declaration. |
| **Liquids / aerosols** | Volume and pressure limits apply. Must be properly packaged and declared. |
| **Food / perishables** | Subject to biosecurity and phytosanitary rules. Australia, NZ, and Japan are strictest. |
| **Pharmaceuticals** | Prescription drugs often prohibited for import. OTC drugs may require declaration. |
| **Alcohol / tobacco** | Heavily regulated. Most carriers will not ship internationally. |
| **Plants / seeds / soil** | Biosecurity restrictions in most countries. Often requires phytosanitary certificate. |
| **Weapons / ammunition** | Prohibited by virtually all carriers for international shipment. |
| **Currency / precious metals** | Special declaration and insurance requirements. |
| **Counterfeit goods** | Seized and destroyed at customs. |

When a user mentions any of these categories, advise them to verify destination country import regulations and carrier policies before shipping.

---

## Best Practices

1. **Always validate both addresses** before creating an international shipment.
2. **Include HS codes** on all customs items. This reduces clearance delays.
3. **Use DDP for better customer experience** when supported by the carrier and when the seller has tax registration.
4. **Set EEL/PFC** on customs declarations for US-origin shipments. Use `NOEEI_30_36` for Canada, `NOEEI_30_37_a` for other destinations under $2,500.
5. **Declare accurate values.** Under-declaration risks fines and seizure.
6. **Include sender email and phone.** All carriers require this for international shipments.
7. **Check DHL Express for non-North-America routes.** DHL typically has the best coverage and speed for international shipments.
