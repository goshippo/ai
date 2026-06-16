# Data quirks and honesty rules

These are the non-obvious behaviors of `GetTrack` data that caused real mistakes when
this report was hand-built. Encode them; do not skip them.

## Per-carrier location differences

- **Evri (`hermes_uk`) scans carry NO coordinates.** Every `location` is blank except
  `country`. An Evri map can only truly place origin + destination; all intermediate
  dots are interpolated and must be labeled (see [geocoding.md](geocoding.md), tier 3).
  This also means **geofence-style triggers are not viable for Evri**: only `status`
  and `substatus.code` are reliable.
- **USPS populates `location` on facility scans** (city/state/zip), so USPS routes are
  genuinely geographic. Do not apply the Evri caveat to USPS.

## Timing and ordering

- **`object_created` is NOT `status_date`.** Shippo stamps `object_created` when it
  ingests/refreshes the tracking object, which can be "now" even for scans that
  happened weeks ago. **Always order and time events by `status_date`.** Never build
  timing logic on `object_created`.
- **Expect duplicate, near-simultaneous, and out-of-order scans.** Make any consumer
  idempotent on the event `object_id`.

## Keying and triggers

- **`substatus.code` is the stable key; `status_details` is carrier prose that drifts.**
  The same human string ("information received") can appear for unrelated physical
  moments. For any trigger or keying logic, use `substatus.code` plus `status` for
  coarse state, not the prose.
- **Stall detection keys off time since last scan, not a status change.** A `delayed`
  substatus followed by prolonged silence is the signature. Compute the largest gap
  between consecutive `status_date`s and surface it (the report shows it as an
  "END OF Nd GAP" badge and a dashed-red route segment).

## First scan

- The **first real carrier scan** is the first physical acceptance. Skip `PRE_TRANSIT`
  "information received" / "label created" pseudo-events when identifying it; they are
  not the package entering the network.

## Safety

- **PII minimization:** the report uses only coarse geography (city/state/zip/country)
  from `GetTrack`. It does **not** include recipient/sender names or street lines. Keep
  it that way.
- **Never invent** timestamps, statuses, coordinates, or IDs. Missing data means say
  "Not available" or mark the point approximate.

## Basemap licensing note

The HTML report loads basemap tiles from **OpenFreeMap** via MapLibre GL. OpenFreeMap
is free for public use with **no API key**, and requires attribution
(`OpenFreeMap © OpenMapTiles Data from OpenStreetMap`), which MapLibre renders from the
style. This was a deliberate choice: CARTO's hosted basemaps are restricted to CARTO
enterprise customers and are **not** free for public use, and OpenStreetMap's own tile
servers prohibit product/bulk use. To switch providers (e.g. a keyed provider or a
self-hosted style), change the single `STYLE_URL` constant at the top of the template
script. Tiles load in the **viewer's** browser, so the viewer needs internet access.
