export const SHIPPING_RATE_UAH: number;
export const FREE_SHIPPING_FROM: number;
export const HANDLING_DAYS: [number, number];
export const TRANSIT_DAYS: [number, number];
export const RETURN_DAYS: number;
export function buildProductJsonLd(p: {
  id: number | string;
  name: string;
  price: number | string;
  images?: string[] | null;
  brand?: string | null;
  description?: string | null;
  condition?: string | null;
  available?: boolean | null;
}): Record<string, unknown>;
