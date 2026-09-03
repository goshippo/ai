/** A tracking URL pattern: a string with a {tracking_number} placeholder, or a function. */
export type TrackingUrlTemplate = string | ((trackingNumber: string) => string);

/** Per-carrier tracking URL patterns, keyed by lowercase Shippo carrier token. */
export type TrackingUrlTemplates = Readonly<Record<string, TrackingUrlTemplate>>;

/**
 * Shippo carrier token to buyer-facing carrier name. Shippo supports well over fifty carriers,
 * so this table is a convenience, not a registry: an unknown token is title-cased rather than
 * leaked as snake_case into fulfillment_event.carrier, which a Platform renders to the buyer.
 */
const DISPLAY_NAMES: Readonly<Record<string, string>> = {
  australia_post: 'Australia Post',
  canada_post: 'Canada Post',
  colissimo: 'Colissimo',
  correos: 'Correos',
  deutsche_post: 'Deutsche Post',
  dhl_ecommerce: 'DHL eCommerce',
  dhl_express: 'DHL Express',
  dhl_germany: 'DHL Germany',
  dpd: 'DPD',
  dpd_uk: 'DPD UK',
  fedex: 'FedEx',
  gls_us: 'GLS US',
  lasership: 'LaserShip',
  ontrac: 'OnTrac',
  poste_italiane: 'Poste Italiane',
  purolator: 'Purolator',
  royal_mail: 'Royal Mail',
  sendle: 'Sendle',
  shippo: 'Shippo',
  ups: 'UPS',
  usps: 'USPS',
};

/**
 * Buyer-facing carrier name for a Shippo carrier token. Pass `overrides` to correct or extend
 * the table without waiting for a release.
 */
export function carrierDisplayName(token: string, overrides?: Readonly<Record<string, string>>): string {
  const key = token.trim().toLowerCase();
  const override = overrides?.[key];
  if (override) return override;
  const known = DISPLAY_NAMES[key];
  if (known) return known;
  return token
    .trim()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * The merchant's own Shippo-hosted tracking page. This resolves for every carrier token and
 * every tracking number, unlike the per-carrier table below, and the merchant brands it in the
 * Shippo web app. Documented at tracking/tracking.mdx, "Tracking pages".
 */
export function shippoTrackingPageUrl(userId: string, token: string, trackingNumber: string): string {
  const number = trackingNumber.replace(/\s+/g, '');
  return `https://track.goshippo.com/tracking/${encodeURIComponent(userId)}/${encodeURIComponent(
    token.trim().toLowerCase(),
  )}/${encodeURIComponent(number)}`;
}

/**
 * A merchant-supplied pattern for a carrier, with NO fallback to the built-in table. Kept separate
 * from carrierTrackingUrl so that resolveTrackingUrl can rank a merchant template above the Shippo
 * tracking page while still ranking the built-in table below it. Fusing the two would return a
 * built-in URL at the template's position and the Shippo page would never be reached for USPS,
 * UPS, FedEx or DHL Express, which is most shipments.
 */
export function templateTrackingUrl(
  token: string,
  trackingNumber: string,
  templates?: TrackingUrlTemplates,
): string | undefined {
  const number = trackingNumber.replace(/\s+/g, '');
  if (!number) return undefined;
  const template = templates?.[token.trim().toLowerCase()];
  if (typeof template === 'function') return template(number);
  if (typeof template === 'string' && template) {
    return template.replaceAll('{tracking_number}', encodeURIComponent(number));
  }
  return undefined;
}

/**
 * Public tracking page for a tracking number.
 *
 * The built-in table is a DATED FALLBACK, last verified 2026-09-03, and carrier tracking paths
 * drift every few years: the FedEx entry here is the post-redirect /wtrk/track/ form, because
 * the older /fedextrack/ path now 301s. Shippo's own tracking_url_provider and the merchant's
 * Shippo tracking page both rank above this table in resolveTrackingUrl for that reason. Re-run
 * scripts/check-tracking-urls.ts before a release. Whitespace is stripped from the number for
 * the URL only; the event's tracking_number keeps whatever the carrier sent.
 */
export function carrierTrackingUrl(
  token: string,
  trackingNumber: string,
  templates?: TrackingUrlTemplates,
): string | undefined {
  const key = token.trim().toLowerCase();
  const number = trackingNumber.replace(/\s+/g, '');
  if (!number) return undefined;
  const fromTemplate = templateTrackingUrl(token, trackingNumber, templates);
  if (fromTemplate) return fromTemplate;
  const encoded = encodeURIComponent(number);
  switch (key) {
    case 'usps':
      return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encoded}`;
    case 'ups':
      return `https://www.ups.com/track?tracknum=${encoded}`;
    case 'fedex':
      return `https://www.fedex.com/wtrk/track/?trknbr=${encoded}`;
    case 'dhl_express':
      return `https://www.dhl.com/en/express/tracking.html?AWB=${encoded}`;
    default:
      return undefined;
  }
}
