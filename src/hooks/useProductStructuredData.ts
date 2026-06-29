import { useEffect } from 'react';

interface Product {
  id: number;
  name: string;
  category: string;
  price: number;
  old_price?: number;
  images: string[];
  brand?: string;
  description?: string;
}

export function useProductStructuredData(product: Product | null) {
  useEffect(() => {
    const scriptId = 'product-structured-data';
    // Удаляем старый скрипт если есть
    document.getElementById(scriptId)?.remove();

    if (!product) return;

    const data = {
      "@context": "https://schema.org",
      "@type": "Product",
      "name": product.name,
      "description": product.description || product.name,
      "image": product.images[0] || '',
      "brand": product.brand ? {
        "@type": "Brand",
        "name": product.brand
      } : undefined,
      "category": product.category,
      "offers": {
        "@type": "Offer",
        "url": `https://autoshop-market.vercel.app/product/${product.id}`,
        "priceCurrency": "UAH",
        "price": product.price,
        "availability": "https://schema.org/InStock",
        "seller": {
          "@type": "Organization",
          "name": "AutoShop Market"
        }
      }
    };

    const script = document.createElement('script');
    script.id = scriptId;
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(data);
    document.head.appendChild(script);

    // Очищаем при закрытии товара
    return () => {
      document.getElementById(scriptId)?.remove();
    };
  }, [product]);
}