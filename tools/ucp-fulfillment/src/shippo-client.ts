import { Shippo } from 'shippo';
import type { Rate, ShipmentCreateRequest, Track } from 'shippo/models/components/index.js';
import { NoRatesError, ShippoClientConfigError } from './errors.js';
import type { ShippoShipmentRequest } from './shipment.js';

/**
 * The three SDK surfaces this library touches, injectable for tests.
 *
 * This module is the ONLY one in the package that imports `shippo`. Every mapping module
 * describes Shippo objects structurally instead, which is what lets `@shippo/ucp-fulfillment/core`
 * load with zero third-party modules.
 */
export interface ShippoSdkLike {
  shipments: {
    create(request: ShipmentCreateRequest): Promise<{ rates: Rate[]; status?: string }>;
  };
  rates: {
    listShipmentRatesByCurrencyCode(request: {
      shipmentId: string;
      currencyCode?: string;
      page?: number;
      results?: number;
    }): Promise<{ results?: Rate[] }>;
  };
  trackingStatus: {
    get(trackingNumber: string, carrier: string): Promise<Track>;
  };
}

export interface ShippoClientOptions {
  /** Passed straight to the Shippo SDK's apiKeyHeader. Live and test mode are chosen by the key. */
  apiKeyHeader?: string;
  /** Shippo API version. Default 2018-02-08, the oldest version whose track_updated is a Track. */
  shippoApiVersion?: string;
  sdk?: ShippoSdkLike;
}

export interface ShippoClient {
  /** Create a shipment and return its multi-carrier rates, synchronously. */
  rates(shipment: ShippoShipmentRequest): Promise<Rate[]>;
  /**
   * Rates for an existing shipment expressed in a specific ISO 4217 currency. This is the remedy
   * CurrencyMismatchError names. Requesting a different currency re-queues the shipment, so the
   * caller may need to wait for the shipment status to reach SUCCESS before the converted rates
   * appear; this method returns whatever page Shippo has and throws NoRatesError when it is empty.
   */
  ratesInCurrency(shipmentId: string, currencyCode: string): Promise<Rate[]>;
  /** Fetch the current tracking status for a carrier tracking number. */
  track(carrier: string, trackingNumber: string): Promise<Track>;
}

export function createShippoClient(opts: ShippoClientOptions): ShippoClient {
  let sdk = opts.sdk;
  if (!sdk) {
    if (!opts.apiKeyHeader) {
      throw new ShippoClientConfigError();
    }
    sdk = new Shippo({
      apiKeyHeader: opts.apiKeyHeader,
      shippoApiVersion: opts.shippoApiVersion ?? '2018-02-08',
    });
  }
  const client = sdk;
  return {
    async rates(shipment) {
      // Rate generation is asynchronous by default and returns an EMPTY rates array. A checkout
      // cannot poll, so the synchronous response is forced here and is not an option.
      const created = await client.shipments.create({ ...shipment, async: false });
      if (!created.rates || created.rates.length === 0) throw new NoRatesError(created.status);
      return created.rates;
    },
    async ratesInCurrency(shipmentId, currencyCode) {
      const page = await client.rates.listShipmentRatesByCurrencyCode({ shipmentId, currencyCode });
      if (!page.results || page.results.length === 0) throw new NoRatesError(undefined);
      return page.results;
    },
    track(carrier, trackingNumber) {
      return client.trackingStatus.get(trackingNumber, carrier);
    },
  };
}
