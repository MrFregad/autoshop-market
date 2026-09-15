import { useEffect } from 'react';
import { buildProductJsonLd } from '../lib/productJsonLd.js';

// Той самий id ставить сервер (api/meta.mjs), тож серверний блок теж
// видаляється — на сторінці завжди рівно один Product.
const SCRIPT_ID = 'product-jsonld';

export function useProductStructuredData(product: Parameters<typeof buildProductJsonLd>[0] | null) {
  useEffect(() => {
    document.getElementById(SCRIPT_ID)?.remove();
    if (!product) return;

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(buildProductJsonLd(product));
    document.head.appendChild(script);

    return () => document.getElementById(SCRIPT_ID)?.remove();
  }, [product]);
}
