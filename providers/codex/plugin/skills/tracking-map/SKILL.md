---
name: tracking-map
description: >-
  Generate an interactive HTML map + chronological timeline of a package's
  tracking history from a tracking number, using the Shippo MCP GetTrack
  operation. Use this when someone wants to SEE a shipment's journey: "map this
  tracking number", "show me where this package went", visualize a parcel's
  route, build a clickable scan-by-scan map, or inspect scan events on a map to
  design webhook triggers. If the request is just a tracking number with no clear
  signal they want a visual map, ask whether they want the interactive map (this
  skill) or a plain tracking status/details summary (the Tracking workflow) before
  building. Produces a downloadable self-contained .html file, not customer-facing
  copy.
---
<!--
  ⚠️  DO NOT EDIT. Auto-generated from skills/tracking-map/SKILL.md by scripts/sync.js
  Edits here will be overwritten on the next sync.
  To change this content, edit the canonical source and re-run the sync script.
-->


# Tracking Map Builder

Turn a single tracking number into a **self-contained, interactive HTML report**
of the package's journey: a **map** with the route plotted, and a
**chronological event timeline** synchronized with it (hover an event to
highlight its point; hover a route leg to see the time in transit between two
scans; click to expand the raw payload and pan the map). All data comes from the
Shippo MCP read-only `GetTrack` operation.

This is for **internal logistics and support** use, e.g. dissecting tracking
events to design webhook triggers. It is not customer-facing copy. The report
also prints a plain-text event timeline in the reply, so it stays useful without
a browser or when the map cannot load.

## When to use

Use this when someone clearly wants to **see** a shipment's journey rather than
just read a status: "map this tracking number", "show me where this package went",
"route for 9261...", "tracking history as a map", "build me a clickable scan-by-scan
view", or "I want to inspect the scan events to design a webhook".

**Disambiguate a bare tracking number first.** If the user only gives a tracking
number (or "track this") with no clear signal they want a visual map, do not
assume. Ask which they want:

- the **interactive map** (this skill: a self-contained HTML route + timeline), or
- a **plain status/details summary** (the Tracking workflow: a straightforward
  `GetTrack` lookup presented as a short table, no map).

Only build the map once the user has signaled they want it (either up front or in
answer to that question). A plain "what's the status of X" with no visual intent is
the Tracking workflow's job, not this skill's.

## Step 1: Resolve the carrier token

`GetTrack` needs a Shippo carrier **token** (e.g. `usps`, `ups`, `fedex`,
`dhl_express`, `hermes_uk`), not a display name.

- If the user gave a carrier name, map it via
  [`references/carrier-tokens.md`](references/carrier-tokens.md).
- If they didn't, infer from the number's format (the same reference has the
  heuristics). If still unsure, **ask**. Do not silently brute-force many tokens.
- **Evri uses `hermes_uk`**, not `evri` (passing `evri` errors). This is the
  classic gotcha; see the reference.

## Step 2: Call `GetTrack`

Call the Shippo MCP read tool: `shippo_read_execute_tool`, operation `GetTrack`,
args `{ Carrier, TrackingNumber }`. Discover or confirm operation names with
`shippo_list_tools` / `shippo_describe_tool` if needed.

If the first token errors, try the documented alternate before giving up (the
classic case: `evri` errors, `hermes_uk` works). If it still fails, ask the user
for the carrier rather than guessing.

**Tracking fees (confirm first for external numbers):** if the user signals the
number is not a Shippo-created label (an arbitrary or external carrier number),
**confirm before calling `GetTrack`**, because tracking a shipment that was not
created in your Shippo account may incur a tracking fee per your plan. For tracking
pricing questions, point the user to Shippo's API pricing
(https://goshippo.com/pricing/api) or contact sales
(https://goshippo.com/contact/sales). When a number only turns out to be external
after the call (Step 3, null `transaction`), surface the same note then.

## Step 3: Note ownership (from the `transaction` field; optional deeper lookup)

If `GetTrack` returned tracking data, **that is enough to build the report**, which
is what the user actually wants. This step is a short note and an *optional* offer;
it must **not** block or delay rendering. Read the `transaction` field already
present in the `GetTrack` response (no extra call needed to see null vs non-null):

- **`transaction` is null:** the label was not purchased in this Shippo account,
  which is fine. Say so plainly, e.g. "It doesn't appear this label was purchased
  in Shippo, but we can still build the report from the tracking details." The
  report is tracking-only (no label/billing/parcel facts), and `ownershipNote` is
  "not purchased in this Shippo account." Note that tracking a shipment not created
  in your Shippo account may incur a tracking fee per your plan; for pricing
  questions, point the user to Shippo's API pricing
  (https://goshippo.com/pricing/api) or contact sales
  (https://goshippo.com/contact/sales).
- **`transaction` is non-null:** the shipment references a Shippo transaction. Build
  and present the report from `GetTrack` as normal (leave `ownershipNote` null, or
  note "references a Shippo transaction, not verified"). Do **not** call
  `GetTransaction` automatically. Instead, tell the user they can ask for an
  additional `GetTransaction` lookup on that ID if they purchased the label under
  their own account and want the label/billing/parcel facts. If they ask:
  - call `GetTransaction` **once** (do **not** retry);
  - on success, add the label/billing/parcel facts and set `ownershipNote` to
    "confirmed in this account";
  - on a 500/internal error, treat it as not associated with this account: report
    that only `GetTrack`-level detail is available and set `ownershipNote` to "not
    associated with this account."

One populated `transaction` field is not proof of ownership, so do not claim it as
yours until a `GetTransaction` lookup confirms it.

## Step 4: Build the event model

Take `tracking_history[]` (oldest-first) plus the `tracking_status` as the
final/current state. For each event capture: `status_date`, `status`,
`substatus.code`, `status_details`, `location { city, state, zip, country }`, and
`object_id`.

- Identify the **first real carrier scan**: the first physical acceptance. Skip
  `PRE_TRANSIT` "information received" / "label created" pseudo-events.
- Order and time everything by `status_date`, never `object_created`.
- Compute the largest gap between consecutive `status_date`s for stall detection.

See [`references/data-quirks.md`](references/data-quirks.md) for why these rules
matter (they caused real mistakes when this report was hand-built).

## Step 5: Geocode the events

Turn each scan's `location` into a map point using the tiered strategy in
[`references/geocoding.md`](references/geocoding.md): real `city`/`state`/`zip`
geocodes to a point; named facilities use a small lookup table; blank locations
are **interpolated and flagged `approx: true`**. Always plot origin and
destination as true anchor points when present.

**Carrier reality check:** USPS populates `location` on facility scans, so those
routes are genuinely geographic. Evri (`hermes_uk`) carries no per-scan
coordinates, so an Evri map can only truly place origin + destination; every
intermediate dot is interpolated and must be labeled.

## Step 6: Render and present

**Build the report whenever `GetTrack` returned tracking data**, that is the
deliverable the user wants. Do not gate it on the ownership lookup (Step 3): the
`GetTransaction` check is optional and runs only if the user asks. One thing you
must still surface, though: if the label was **not** created in Shippo (`transaction`
is null), include the tracking-fee/pricing note from Step 3 in your reply (Shippo
API pricing: https://goshippo.com/pricing/api, or contact sales:
https://goshippo.com/contact/sales).

Render the HTML from [`assets/report-template.html`](assets/report-template.html)
by replacing the `{{REPORT_DATA_JSON}}` placeholder with the JSON object below (raw
JSON, no surrounding quotes; it sits inside backticks in the template). Save the
file to the outputs directory.

**Replace the placeholder by exact string match, not by position.**
`{{REPORT_DATA_JSON}}` is intentionally unique and appears exactly once (on the
`const RAW` line). Confirm it occurs exactly once before replacing and zero times
after; if the count is not one, stop and report it rather than render a wrong file.
A first-occurrence or line-number replace is what previously injected the data into
a comment and left `const RAW` holding the literal placeholder, so the page fell
back to the built-in sample. Also make sure the JSON has no unescaped backtick or
`${` sequence, since it sits inside a template-literal string.

**Present it as a file to open in a browser, not as inline HTML.** Give the user
the saved file path (or a link) and say plainly: "Open this in your web browser to
view the interactive map." Do **not** paste the full HTML into the reply or emit it
as an inline code/artifact block: besides being noisy, that is what makes some
desktop clients auto-open an in-app preview pane, and the map cannot render there
(those previews block the CDN map library, so it shows blank). The saved file plus
the text timeline below are the deliverables.

Then **always also print a short plain-text event timeline in the reply** (oldest
to newest: UTC timestamp, location or "no location", `status` / `substatus.code`,
detail). This is the graceful-degradation path: the map needs internet in the
viewer's browser, and the text timeline keeps the skill useful without one.

Surface any data-honesty caveats in the chat reply, not buried in the file:
interpolated points, an Evri "no coordinates" note, a detected stall, the
ownership result (not purchased in Shippo, or not associated with this account),
and any tracking-fee note for an external lookup (see Step 3).

### Report data shape (`{{REPORT_DATA_JSON}}`)

```json
{
  "meta": {
    "carrierName": "USPS", "carrierToken": "usps",
    "serviceLevel": "Parcel Select",
    "trackingNumber": "9261...", "trackingNumberPretty": "9261 2903 ...",
    "originLabel": "Woodmere, NY", "destLabel": "Madison, AL",
    "statusLabel": "DELIVERED",
    "eventCount": 21, "firstScan": "05 Mar 21:29", "delivered": "13 Apr 17:58",
    "transit": "38d 20h",
    "ownershipNote": "not purchased in this account or null",
    "legendNote": "Solid dots = real scans; faded = interpolated."
  },
  "origin":      { "lat": 40.632, "lng": -73.713, "label": "Woodmere, NY 11598" },
  "destination": { "lat": 34.699, "lng": -86.744, "label": "Madison, AL 35758" },
  "banners": [
    { "kind": "delay or info", "title": "...", "body": "... (may contain <code>)" }
  ],
  "events": [
    {
      "lat": 40.632, "lng": -73.713,
      "c": "teal | amber | green | slate | red",
      "status": "TRANSIT", "sub": "package_accepted",
      "date": "2026-03-05T21:29:06Z",
      "detail": "USPS has picked up the item.",
      "loc": "Woodmere, NY 11598",
      "city": "Woodmere", "state": "NY", "zip": "11598", "country": "US",
      "approx": false,
      "id": "50be35695b964659acf7951f9d34aae0",
      "first": true,
      "gap": true,
      "gapBadge": "END OF 34d GAP"
    }
  ]
}
```

Dot color (`c`) maps to event meaning: teal = pickup/accepted, amber = facility
scan / in transit, green = delivered, slate = pre-transit / info, red = delay /
exception. Set `first: true` on the first real carrier scan. When the route
resurfaces after a long silence, set `gap: true` and a `gapBadge` on the
resurfacing scan; the template draws that segment dashed-red. `origin`,
`destination`, `serviceLevel`, and `ownershipNote` may be `null`.

The template is **self-contained**: one HTML file, inline CSS/JS, MapLibre GL + the
OpenFreeMap basemap from CDN. It needs internet **in the viewer's browser** for the
map; say so when you present the file. To change the basemap, edit the single
`STYLE_URL` constant at the top of the template script (see
[`references/data-quirks.md`](references/data-quirks.md) for the licensing note).

## Edge cases and guardrails

- **Read-only:** this skill only ever calls Shippo `read` operations (`GetTrack`,
  and at most `GetTransaction` / `ListTransactions` for the ownership check). Never
  call a `write` op such as `CreateTrack` (which registers a tracking webhook).
- **Stale objects:** Shippo does not return objects older than ~390 days. If a
  lookup fails for that reason, note it and build from whatever `GetTrack` returned.
- **No history / unknown number:** if `tracking_history` is empty or the status is
  `UNKNOWN`, still render origin/destination if available and say the carrier has
  no scans yet.
- **`GetTransaction` is optional and only runs on user request** (Step 3); the
  report is always built from `GetTrack`. When you do call it, call it **once** and
  do **not** retry. A 500/internal error is the signal: treat it as the
  not-associated-with-this-account case and keep to `GetTrack`-level detail.
  Retrying only adds latency.
- **PII minimization:** use only coarse geography (city/state/zip/country). Do not
  include recipient/sender names or street lines.
- **Never invent** timestamps, statuses, coordinates, or IDs. Missing data means
  "Not available" or an `approx` point.

## References

- [`references/carrier-tokens.md`](references/carrier-tokens.md): display-name to
  Shippo carrier token map, format-inference heuristics, the Evri gotcha.
- [`references/geocoding.md`](references/geocoding.md): the tiered strategy for
  turning scan locations into map points, and the real-vs-interpolated rule.
- [`references/data-quirks.md`](references/data-quirks.md): per-carrier payload
  differences, the timing/keying honesty rules, and the basemap licensing note.
