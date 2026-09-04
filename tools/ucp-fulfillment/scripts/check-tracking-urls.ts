/**
 * Manual check of the built-in carrier tracking URL table. NOT in CI: carrier bot protection
 * returns 403 or drops the connection from data-centre addresses, which would make CI flaky and
 * teach the team to ignore a red check. Run it by hand before a release and read the output.
 *
 *   node --import tsx scripts/check-tracking-urls.ts
 *
 * A 200 or a 3xx to a tracking page is fine. A 404, or a redirect to a marketing home page, means
 * the pattern moved: fix carriers.ts and bump the "last verified" date in its doc comment.
 */
import { carrierTrackingUrl } from '../src/carriers.js';

const SAMPLES: Array<[string, string]> = [
  ['usps', '9400111899223197428490'],
  ['ups', '1Z999AA10123456784'],
  ['fedex', '123456789012'],
  ['dhl_express', '1234567890'],
];

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

for (const [token, number] of SAMPLES) {
  const url = carrierTrackingUrl(token, number);
  if (!url) {
    console.log(`${token.padEnd(14)} NO BUILT-IN URL`);
    continue;
  }
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(15_000),
    });
    const location = response.headers.get('location') ?? '';
    console.log(`${token.padEnd(14)} ${String(response.status).padEnd(4)} ${location} ${url}`);
  } catch (error) {
    console.log(`${token.padEnd(14)} ERROR ${(error as Error).message} ${url}`);
  }
}
