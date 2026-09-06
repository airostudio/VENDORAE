import type { ShippingProvider } from "../shipping";
import type { Shipment, ShipmentRequest, ShippingRate, ShippingRateRequest } from "../../types";

export interface ShippingMethodConfig {
  id: string;
  name: string;
  countries: string[]; // ISO alpha-2; empty = all countries
  priceCents: number;
  currency: string;
  freeShippingThresholdCents?: number;
  allowedShippingClasses: ShippingRateRequest["items"][number]["shippingClass"][];
  etaDaysMin?: number;
  etaDaysMax?: number;
}

/**
 * Database-configured flat-rate/threshold shipping. Suitable as the default
 * provider before a live carrier integration (e.g. EasyPost, Shippo) is
 * connected. Respects per-method shipping-class and country restrictions so
 * oversized/freight shipments aren't quoted the same as a small
 * accessory, and so excluded regions never see a rate.
 */
export class FlatRateShippingProvider implements ShippingProvider {
  id = "flat-rate";
  displayName = "Flat Rate Shipping";

  constructor(private readonly methods: ShippingMethodConfig[]) {}

  async calculateRates(request: ShippingRateRequest): Promise<ShippingRate[]> {
    const requiredClasses = new Set(request.items.map((i) => i.shippingClass));

    return this.methods
      .filter((m) => m.countries.length === 0 || m.countries.includes(request.destination.country))
      .filter((m) => [...requiredClasses].every((c) => m.allowedShippingClasses.includes(c)))
      .map((m) => {
        const free =
          m.freeShippingThresholdCents !== undefined &&
          request.subtotal.amount >= m.freeShippingThresholdCents;
        return {
          methodId: m.id,
          name: m.name,
          price: { amount: free ? 0 : m.priceCents, currency: m.currency },
          etaDaysMin: m.etaDaysMin,
          etaDaysMax: m.etaDaysMax,
        };
      });
  }

  async createShipment(request: ShipmentRequest): Promise<Shipment> {
    return {
      id: `shp_${Math.random().toString(36).slice(2, 12)}`,
      status: "pending",
    };
  }

  async getTracking(shipmentId: string): Promise<Shipment> {
    return { id: shipmentId, status: "pending" };
  }

  async cancelShipment(): Promise<void> {}
}
