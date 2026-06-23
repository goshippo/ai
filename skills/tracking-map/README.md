# tracking-map

*Editing this skill? Edit [`SKILL.md`](SKILL.md): that's the contract the assistant loads. This README is human-facing orientation only; don't duplicate canonical facts here.*

Turn a tracking number into a self-contained, interactive HTML report of the package's journey: a map with the route plotted, plus a chronological event timeline synced to it (hover an event to highlight its point, click to expand the raw payload and pan the map). Data comes from the Shippo MCP read-only `GetTrack` operation. The report also prints a plain-text event timeline in the reply, so it stays useful without a browser. It is read-only and for internal logistics/support use (e.g. inspecting scan events to design webhook triggers), not customer-facing copy.

## When to use

- "Map this tracking number" / "show me where this package went"
- "Route for 9261..." / "tracking history as a map"
- "Build me a clickable scan-by-scan view of this shipment"
- "I want to inspect the scan events to design a webhook trigger"

## When NOT to use

- "What's the status of this package?" with no visual or investigative intent: use `tracking`.
- A bare tracking number with no clear signal they want a map: ask first whether they want the interactive map (this skill) or a plain status/details summary (`tracking`), then route accordingly.
- "Set up / register a tracking webhook": that is a write operation; this skill is read-only.
- "Write up a support ticket for a stuck package": use `shippo-support-ticket`.

## Example prompts

- "Map the tracking history for USPS 92612903367210541430565958"
- "Show me where this Evri parcel went: H01M8A0096717992"
- "Make a clickable map of this UPS number, I want to inspect the scan events for a webhook"

## Related

- `tracking`: the underlying `GetTrack` status/history this report is built from
- `shippo-support-ticket`: when the goal is escalating a shipment issue, not visualizing it
- `shippo/references/carrier-guide.md`: per-carrier nuances (tokens, scan behavior)
