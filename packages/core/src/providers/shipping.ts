import type { Shipment, ShipmentRequest, ShippingRate, ShippingRateRequest } from "../types";

/**
 * A shipping/rate/fulfillment adapter. Heavy or oversized goods need
 * carrier-specific handling (freight, special courier, region exclusions),
 * so rate calculation is delegated to the configured provider rather than
 * computed inline in checkout.
 */
export interface ShippingProvider {
  id: string;
  displayName: string;

  calculateRates(request: ShippingRateRequest): Promise<ShippingRate[]>;
  createShipment(request: ShipmentRequest): Promise<Shipment>;
  getTracking(shipmentId: string): Promise<Shipment>;
  cancelShipment(shipmentId: string): Promise<void>;
}

export class ShippingProviderRegistry {
  private providers = new Map<string, ShippingProvider>();

  register(provider: ShippingProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(id: string): ShippingProvider {
    const provider = this.providers.get(id);
    if (!provider) throw new Error(`Unknown shipping provider: ${id}`);
    return provider;
  }

  list(): ShippingProvider[] {
    return [...this.providers.values()];
  }
}
