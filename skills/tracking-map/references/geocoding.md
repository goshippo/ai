# Geocoding scan locations

`GetTrack` returns a `location` object per scan, but what it contains varies widely
by carrier (see [data-quirks.md](data-quirks.md)). Turning those into map points
needs a tiered approach. The goal is honest placement: every plotted dot is either a
real, carrier-reported location or an explicitly-flagged interpolation. Never present
an interpolated point as a real fix.

## Tier 1: full `city` / `state` / `zip`

Common on USPS facility and delivery scans. Geocode to a point. Preferred source order:

1. A bundled ZIP-to-centroid lookup, if a dataset ships with the skill.
2. A geocoding call, if the session has network access.
3. A small bundled city-centroid table for the most common metros.

Accuracy is "area centroid," which is fine for this report. Label it as such; do not
imply street-level precision.

## Tier 2: named facility, no city / zip

Some scans give a facility name with blank `city`/`state`/`zip`, e.g. USPS
`"Columbus Oh Distribution Center"`. Maintain a small **facility-name to coordinate**
table below and grow it over time. These are processing-center scans; metro-level
accuracy is acceptable.

| Facility (as it appears in `location`) | Lat | Lng |
|---|---|---|
| _Add rows as you encounter them_ | | |

## Tier 3: blank location

Some scans carry no usable location at all, e.g. USPS "Your shipment is in transit"
and **every** Evri scan. **Interpolate** a position along the route between the
nearest bracketing known points, and **flag the event `approx: true`**. In the
report these render faded/smaller and carry an "interp. location" tag.

## Anchors

Always plot origin (`address_from`) and destination (`address_to`) as true points
when present. They bound the route and are the only genuinely-placed points on a
carrier (like Evri) that reports no per-scan coordinates.

## Legend honesty

State explicitly in the report legend which dots are real and which are interpolated.
The `legendNote` field in the report data is the place for this (e.g. "Solid dots =
real scans; faded = interpolated").
