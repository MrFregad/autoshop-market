export interface PriceTier {
  maxCost: number;
  coefficient: number;
  minMarginUah: number;
}

export interface PriceResult {
  price: number;
  oldPrice: number | null;
  marginUah: number;
  marginPercent: number;
  tierIndex: number;
  needsMarketCheck: boolean;
}

export const PRICE_TIERS: PriceTier[];
export const MARKET_CHECK_THRESHOLD: number;
export const FREE_SHIPPING_THRESHOLD: number;
export function roundPrice(value: number): number;
export function calculatePrice(cost: number): PriceResult;
export function isBelowFloor(cost: number, price: number): boolean;
