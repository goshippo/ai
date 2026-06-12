---
name: shippo-support-ticket
description: Generate a complete, auto-classified, ready-to-paste Shippo support ticket for a single shipment or label. Use when a support agent or customer needs to escalate a shipping issue (lost/delayed package, unused-label refund, billing/rate adjustment, address exception, customs hold, carrier-account, or tracking-webhook problem). Given a tracking number + carrier, a transaction (label) ID, or a shipment ID, it classifies the issue, runs the right read-only Shippo MCP lookups, computes the triage timeline, and emits both a copy-paste support message and a routing-tagged JSON block so the ticket lands in the right pipeline first time.
---
<!--
  ⚠️  DO NOT EDIT. Auto-generated from skills/shippo-support-ticket/SKILL.md by scripts/sync.js
  Edits here will be overwritten on the next sync.
  To change this content, edit the canonical source and re-run the sync script.
-->


# Shippo Support Ticket Builder

Turn a single shipment identifier into a complete, **classified**, well-structured
support package for the Shippo support team. The agent classifies the issue,
gathers every relevant fact from the Shippo MCP (running issue-type-specific
lookups, not just the lost-package set), computes the triage timeline, and emits
two things:

1. A **human copy-paste block** for the ticket body.
2. A **structured JSON block** tagged with a routing queue, so the ticket can be
   piped into the ticketing system and land in the right pipeline without a
   human re-classifying it.

This dual output is the point: completeness *and* correct routing are what kill
the back-and-forth.

Audience: Shippo support agents. Output uses Shippo terminology, object IDs, and
an internal routing tag. It is not customer-facing copy.

## When to use

Use this skill when someone wants to escalate or document a shipping problem and
asks for a support ticket / message to Shippo support, e.g. "package is stuck,"
"label was charged but never shipped," "why was I charged more than the rate I
saw," "refund this label I never used," "where is this delivery," "the address
looks wrong," "tracking updates aren't coming through," "can't get rates from
this carrier." It produces **text + JSON to copy and paste**; it does not open a
Jira ticket or send Slack/email itself.

## Step 1: Classify the issue (do this first)

Pick exactly one **canonical issue type** from the customer's description. The
issue type drives both the routing tag and which extra lookups you run in Step 4.
If the wording is ambiguous, ask one clarifying question before building.

| Issue type (canonical) | Triggers / signals | Routing tag |
|---|---|---|
| `lost_or_delayed` | stuck, late, no movement, "where is my package", lost | `queue:tracking-ops` |
| `unused_label_refund` | "never shipped", "refund this label", bought-but-unused | `queue:billing-refunds` |
| `billing_adjustment` | "charged more than the rate", surcharge, reweigh, dim-weight, address-correction fee | `queue:billing-adjustments` |
| `address_exception` | undeliverable, returned to sender, bad/invalid address, address correction | `queue:address-exceptions` |
| `customs_international` | customs hold, duties/taxes, missing HS code, commercial invoice, international | `queue:customs-intl` |
| `carrier_account` | "can't get rates from <carrier>", connection failed, registration pending | `queue:carrier-onboarding` |
| `tracking_webhook` | "tracking updates aren't coming through", webhook not firing | `queue:integrations` |
| `other` | anything that doesn't fit above | `queue:general-triage` |

> The routing tags above are **placeholders for Shippo's real support queue
> names**. Confirm the actual queue/label taxonomy and update this table once.
> The skill's value is producing a consistent, machine-parseable tag; the exact
> strings should match your ticketing system.

## Inputs accepted

The user may start from any **one** of these. Ask which one they have if it is
ambiguous; do not guess an ID type.

| Input | What it anchors |
|---|---|
| **Tracking number + carrier** | Drives `GetTrack` directly. Best for delivery/lost-package issues. |
| **Transaction (label) object ID** | Cleanest anchor: label creation time + tracking number + the rate/shipment link, all derivable. |
| **Shipment object ID** | Gives from/to addresses, requested `shipment_date`, and rates; tracking number comes from the purchased transaction. |

> **Resolving a tracking number to its label.** First detect the carrier and map
> it to the Shippo carrier *token* (see the note below), then call `GetTrack`.
> When the label was purchased through Shippo, the `GetTrack` response carries the
> transaction `object_id`; use that with `GetTransaction` to pull the label and
> billing facts. If the label was not bought through Shippo (no transaction comes
> back), there is nothing to resolve: build the ticket from `GetTrack` plus
> whatever the user supplied and mark the label fields "Not available."
> `ListTransactions` has no server-side `tracking_number` filter, so paging it to
> match by hand is a rarely-useful last resort, not the primary path.

> **Carrier token:** `GetTrack` expects a Shippo carrier *token*, not a display
> name, e.g. `usps`, `ups`, `fedex`, `dhl_express`, `dhl_ecommerce`,
> `canada_post`. If you only have a display name (often from a rate's
> `provider`), map it to the token. If unsure, ask the user for the carrier.

## Shippo MCP tools used

Discover/confirm with `shippo_list_tools` and `shippo_describe_tool`; execute
read-only lookups with `shippo_read_execute_tool`. **Everything this skill needs
is a `read` operation; never call a `write` tool (e.g. `CreateRefund`) from
this skill; the ticket only documents and recommends.**

Core reads (all issue types):

- `GetTransaction`: label creation time (`object_created`), `tracking_number`, `status`, `rate` reference, `eta`, `metadata` (order/internal reference)
- `GetShipment`: `address_from`, `address_to`, requested `shipment_date`, `parcels`, `rates`, `customs_declaration`, `extra` (added services + references), `messages`
- `GetTrack`: current `tracking_status`, full `tracking_history[]`, `eta`, and (for Shippo-purchased labels) the `transaction` object reference

Issue-type-specific reads (Step 4):

- `GetRate`: purchased `amount`, `currency`, `provider`, `servicelevel`, `estimated_days` (billing)
- `GetParcel`: declared `length/width/height`, `distance_unit`, `weight`, `mass_unit` (billing)
- `ListRefunds` / `GetRefund`: existing refund object + `status` (refund)
- `ValidateAddress` / `ValidateAddressByID`: `is_valid`, `messages`, residential flag (address)
- `GetCustomsDeclaration` / `GetCustomsItem`: `contents_type`, `incoterm`, `eel_pfc`, per-item `tariff_number` (HS code), `value_amount`, `origin_country` (customs)
- `ListCarrierAccounts` / `GetCarrierAccount` / `GetCarrierRegistrationStatus`: `active`, registration status (carrier-account)
- `listWebhooks` / `getWebhook`: `url`, `event`, `active` (webhook)

## Step 2: Resolve the anchor object

Always work toward having the four core objects: **transaction**, **shipment**,
**addresses**, and **tracking**. Stop early only when the issue genuinely needs
nothing more (e.g. a pure tracking-status question with no label on file).

- **Transaction ID** → `GetTransaction`. Read `object_created` (label creation
  time), `tracking_number`, `tracking_url_provider`, `status`, and the `rate`
  reference. Inspect for a `shipment` reference to get the shipment ID.
- **Shipment ID** → `GetShipment`. Read `address_from`, `address_to`,
  `shipment_date` (the **requested** ship date), `parcels`, `rates`,
  `customs_declaration`. Find the purchased rate/transaction for the tracking #.
- **Tracking number + carrier** → map the carrier to its token and call
  `GetTrack`. For a Shippo-purchased label the response carries the transaction
  `object_id`; follow it with `GetTransaction` to get the billing/label facts.

## Step 3: Pull the core facts

Pull the shipment (`GetShipment`) for `address_from`, `address_to`,
`shipment_date` if not already loaded, and tracking (`GetTrack` with carrier
token + tracking number) for `tracking_status`, `tracking_history[]`, and `eta`.

> From each address object capture only its `object_id` and coarse geography
> (`city`, `state`, `zip`, `country`) for the ticket, **not** `name`,
> `street1`, or `street2` (see PII minimization in guardrails).

- **First carrier scan** = the earliest `tracking_history` event representing
  physical acceptance by the carrier (the first `TRANSIT`/`DELIVERED`-class scan,
  or the carrier's "accepted/picked up" event). Pre-transit / "label created" /
  "shipment info received" pseudo-events do **not** count; call those out
  separately if present.
- **Added services and order reference (capture them):** surface the shipment's
  `extra` block (added services such as `signature_confirmation`, `insurance`,
  Saturday delivery, QR-code labels) and the customer's own order / internal
  reference number. That reference can live in two places depending on the
  integration: the transaction's `metadata` field (the documented home for order
  numbers) and/or the shipment `extra` reference fields. Capture it from wherever
  it actually appears, so the agent can tie the ticket back to the order without
  searching on an order number. The `extra` schema is nuanced and
  carrier/service-dependent, so **read the actual response fields rather than
  assuming names**: the `label-purchase` skill documents the common added-service
  options (signature, insurance, Saturday delivery) and
  `shippo/references/carrier-guide.md` covers per-carrier availability. Surface
  only what is actually present; omit the rest.
- **`messages` noise:** a shipment's `messages` array often carries routine
  "carrier doesn't support option" / "out of service area" entries. These are
  informational. Only surface messages tied to a carrier that actually appears
  in `rates`.
- **Read the actual response fields:** do not assume names. If a field is
  absent, record "Not available" rather than inventing a value.

## Step 4: Run the issue-type branch

After the core facts, run **only** the lookups for the classified issue type and
fill the matching section of the output. Skip branches that don't apply.

- **`lost_or_delayed`**: no extra reads; the core timeline carries it. Emphasize
  "last scan → now" and "overdue vs ETA."
- **`unused_label_refund`**: Was the label ever scanned? Re-check `GetTrack`: if
  there is a real carrier scan, the label is **used** (not eligible as an unused
  refund). Say so. Compute **label age** from `object_created` to now. Call
  `ListRefunds` (and `GetRefund`) to report any existing refund object + its
  `status`. Do **not** assert a specific eligibility window from memory; state
  the facts (used/unused, age, existing refund) and let the queue apply policy.
- **`billing_adjustment`**: `GetRate` for the purchased `amount`/`currency`;
  `GetParcel` (or shipment `parcels`) for **declared** dims/weight; compare the
  transaction's charged amount to the quoted rate. Flag the likely cause:
  dimensional-weight reweigh (declared vs billed dims), address-correction
  surcharge, or service upgrade. Report declared-vs-billed as the core evidence.
  Note: the reweigh/adjustment amount and the carrier's *billed* dims may not be
  exposed by these read ops; if so, record "Not available" rather than inferring.
- **`address_exception`**: run `ValidateAddress`/`ValidateAddressByID` on
  `address_to`; report `is_valid`, any validation `messages`, and the
  residential/commercial flag. Note whether validation was bypassed at purchase.
- **`customs_international`**: pull `GetCustomsDeclaration` + each
  `GetCustomsItem`. Check completeness: `contents_type`, `incoterm`,
  `eel_pfc`/AES exemption, and per item a `tariff_number` (HS code),
  `value_amount`, and `origin_country`. Flag missing HS codes / values, the
  usual cause of customs holds.
- **`carrier_account`**: `ListCarrierAccounts`, then `GetCarrierAccount` /
  `GetCarrierRegistrationStatus` for the relevant carrier. Report `active` and
  registration status; an incomplete registration is the usual "no rates" cause.
- **`tracking_webhook`**: `listWebhooks` + `getWebhook`. Report whether an
  `active` webhook exists for the relevant `track_updated`/tracking event and the
  configured `url`.

## Timeline to compute

These derived metrics pre-diagnose the issue so support doesn't have to:

- **Label created → first carrier scan**: how long the label sat before entering
  the network. A large gap is the classic "bought but never shipped" signature.
- **Requested `shipment_date` → first carrier scan**: picked up on/near intent?
- **First scan → last scan**: total time in transit so far.
- **Last scan → now**: days of silence; a long gap signals a stalled/lost parcel.
- **ETA vs. now**: is it overdue?

State each as an absolute date/time **and** a duration (e.g. "Label created
2026-06-01 14:02 UTC; first scan 2026-06-05 09:11 UTC, a 3d 19h gap"). Use UTC
and label it. In the JSON block, also emit each gap in whole hours.

## Output

Emit **both** blocks below, each as its own fenced block. Replace every `<...>`
placeholder; use "Not available" for anything you could not retrieve; never
invent values.

**Provenance (required).** Both blocks carry a generation stamp so support can
tell at a glance that the ticket was machine-assembled, and so ticket quality
can be tracked over time. Stamp:

- the **skill name** (`shippo-support-ticket`),
- the **source** (`Shippo MCP`),
- the **generation time in UTC** (ISO 8601).

Never alter or omit the stamp, and never present an auto-generated ticket as if
it were hand-written.

After the blocks, add a short plain-language **triage summary**
(1-3 sentences) naming the most likely problem based on the classification +
timeline, and list any data you could not retrieve.

### Block A: Human ticket (copy-paste)

```
Subject: [<issue_type>] <one-line summary>, tracking <tracking_number>

ROUTING
  Issue type:      <canonical issue type>
  Routing tag:     <queue:...>
  Confidence:      <high | medium | low; note if classified from sparse info>

ISSUE
  Reported by:     <customer name / email, if known>
  Summary:         <2-3 sentence description in plain language>

SHIPMENT
  Shipment ID:     <shipment object_id>
  Transaction ID:  <transaction object_id>
  Carrier:         <carrier display name> (<carrier token>)
  Service level:   <servicelevel name>
  Tracking #:      <tracking_number>
  Tracking URL:    <tracking_url_provider>
  Parcel:          <declared dimensions + weight, if available>
  References:      <order/internal ref from transaction metadata or shipment extra, else "none">
  Added services:  <signature / insurance / QR code / etc. from extra, else "none">

ADDRESSES (no street-level PII; run GetAddress on an ID for full details)
  From address ID: <address_from object_id>
  From region:     <city> <state> <zip> <country>
  To address ID:   <address_to object_id>
  To region:       <city> <state> <zip> <country>

TIMELINE (all times UTC)
  Label created:           <object_created>
  Requested ship date:     <shipment_date>
  First carrier scan:      <status_date> @ <location>   (<status>)
  Last/most recent scan:   <status_date> @ <location>   (<status>)
  Current status:          <tracking_status>
  Carrier ETA:             <eta or "Not available">

  Label created → first scan:     <duration, e.g. 3d 19h>
  Requested ship → first scan:    <duration or note>
  First scan → last scan:         <duration>
  Last scan → now:                <duration>
  Overdue vs ETA:                 <yes/no + by how much>

ISSUE-SPECIFIC FINDINGS
  <Only the block for the classified issue type; examples:>
  [unused_label_refund]  Label used (scanned)? <yes/no>; Label age: <duration>;
                         Existing refund: <refund object_id + status or "none">
  [billing_adjustment]   Quoted rate: <amount> <ccy>; Charged: <amount> <ccy>;
                         Declared dims/wt: <...>; Likely cause: <reweigh/surcharge>
  [address_exception]    Address valid: <yes/no>; Validation messages: <...>;
                         Residential: <yes/no/unknown>
  [customs_international] Contents type: <...>; Incoterm: <...>;
                         Items missing HS code/value: <list or "none">
  [carrier_account]      Carrier: <...>; Active: <yes/no>; Registration: <status>
  [tracking_webhook]     Active webhook for tracking events: <yes/no>; URL: <...>

TRACKING HISTORY (most recent first)
  <status_date>  <status>  <location>  <substatus/text>
  <... one line per scan ...>

WHAT WE NEED FROM SUPPORT
  <the specific ask: locate package / refund label / explain charge / fix
   address / clear customs / complete carrier registration / fix webhook>

(Auto-generated by the "shippo-support-ticket" skill via the Shippo MCP on
  <generation time UTC>. Facts collected automatically; verify before acting.)
```

### Block B: Structured JSON (for the pipeline)

```json
{
  "issue_type": "<canonical issue type>",
  "routing_tag": "<queue:...>",
  "classification_confidence": "<high|medium|low>",
  "reported_by": "<email or name or null>",
  "summary": "<one-line summary>",
  "identifiers": {
    "transaction_id": "<or null>",
    "shipment_id": "<or null>",
    "tracking_number": "<or null>",
    "carrier_token": "<or null>",
    "service_level": "<or null>",
    "order_reference": "<order/internal ref from transaction metadata or shipment extra, or null>"
  },
  "shipment_extra": {
    "<only the added-service `extra` fields actually present; e.g. signature_confirmation, insurance, qr_code>": ""
  },
  "addresses": {
    "from": { "address_id": "<or null>", "city": "", "state": "", "zip": "", "country": "" },
    "to":   { "address_id": "<or null>", "city": "", "state": "", "zip": "", "country": "" }
  },
  "timeline_utc": {
    "label_created": "<ISO8601 or null>",
    "requested_ship_date": "<ISO8601 or null>",
    "first_carrier_scan": "<ISO8601 or null>",
    "last_scan": "<ISO8601 or null>",
    "carrier_eta": "<ISO8601 or null>",
    "current_status": "<or null>"
  },
  "gaps_hours": {
    "label_to_first_scan": "<int or null>",
    "requested_ship_to_first_scan": "<int or null>",
    "first_to_last_scan": "<int or null>",
    "last_scan_to_now": "<int or null>",
    "overdue_vs_eta": "<int or null>"
  },
  "issue_findings": {
    "<keys depend on issue_type; e.g. label_used, label_age_hours, existing_refund_status, quoted_amount, charged_amount, declared_dims, address_is_valid, items_missing_hs_code, carrier_active, registration_status, webhook_active>": ""
  },
  "requested_action": "<the specific ask>",
  "data_gaps": ["<fields that could not be retrieved>"],
  "generated_by": {
    "skill": "shippo-support-ticket",
    "source": "shippo-mcp",
    "generated_at": "<ISO8601 UTC>"
  }
}
```

## Edge cases & guardrails

- **Read-only:** This skill never calls `write` operations. Recommend a refund;
  don't issue one.
- **Multiple matches** when paging `ListTransactions` as a fallback: list the
  candidates and ask the user to pick before building the ticket.
- **Stale objects:** objects older than 390 days aren't returned. If lookups fail
  for that reason, note it and build from whatever the user provided plus tracking.
- **Classification confidence:** if you classified from sparse wording, set
  confidence `low` and say why, so the queue knows to sanity-check the tag.
- **PII minimization (required):** Do **not** put recipient/sender **names** or
  **street lines** (`street1`/`street2`) in the ticket, not in the human block
  and not in the JSON. Reference the `address_from` / `address_to` `object_id`s
  instead; support can run `GetAddress` on an ID to retrieve full details and
  replicate the issue only when they actually need to. Coarse geography
  (city, state/province, ZIP/postal, country) **is** retained, since support
  needs it for zone/routing triage. Tracking-history `location` values
  (typically city/state) are fine. Don't pull in unrelated shipments, and don't
  include API tokens or raw object dumps beyond what the templates ask for.
- **Never invent** timestamps, statuses, addresses, IDs, or HS codes. Missing →
  "Not available" (human block) / `null` (JSON).
