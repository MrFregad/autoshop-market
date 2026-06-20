// Mock Supabase client with localStorage fallback
// Works without real Supabase credentials - stores data locally

const STORAGE_KEYS = {
  products: 'autoshop_products',
  reviews: 'autoshop_reviews',
};

const getLocalData = (key: string) => {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
};

const setLocalData = (key: string, data: any[]) => {
  localStorage.setItem(key, JSON.stringify(data));
};

const createMockSupabase = () => {
  let currentTable = '';
  let filters: Record<string, any> = {};
  let updateData: any = null;
  let insertData: any[] | null = null;
  let isDelete = false;

  return {
    from: (table: string) => {
      currentTable = table;
      filters = {};
      updateData = null;
      insertData = null;
      isDelete = false;
      return chain;
    },
  };

  const chain = {
    select: () => chain,
    order: () => chain,
    eq: (column: string, value: any) => {
      filters[column] = value;
      return chain;
    },
    update: (data: any) => {
      updateData = data;
      return chain;
    },
    insert: (data: any[]) => {
      insertData = data;
      return { error: null };
    },
    delete: () => {
      isDelete = true;
      return chain;
    },
    then: async (callback?: any) => {
      const storageKey = currentTable === 'products' ? STORAGE_KEYS.products : STORAGE_KEYS.reviews;
      let data = getLocalData(storageKey);

      if (insertData) {
        const newItems = insertData.map((item, index) => ({
          ...item,
          id: item.id || Date.now() + index,
          images: Array.isArray(item.images) ? item.images : item.images ? [item.images] : ['https://via.placeholder.com/400'],
        }));
        data = [...newItems, ...data];
        setLocalData(storageKey, data);
        if (callback) callback({ data: newItems, error: null });
        return { data: newItems, error: null };
      }

      if (updateData) {
        const filterKey = Object.keys(filters)[0];
        const filterValue = filters[filterKey];
        data = data.map((item: any) =>
          item[filterKey] === filterValue ? { ...item, ...updateData } : item
        );
        setLocalData(storageKey, data);
        if (callback) callback({ data: updateData, error: null });
        return { data: updateData, error: null };
      }

      if (isDelete) {
        const filterKey = Object.keys(filters)[0];
        const filterValue = filters[filterKey];
        data = data.filter((item: any) => item[filterKey] !== filterValue);
        setLocalData(storageKey, data);
        if (callback) callback({ data: null, error: null });
        return { data: null, error: null };
      }

      // Default: select
      if (filters && Object.keys(filters).length > 0) {
        Object.entries(filters).forEach(([key, value]) => {
          data = data.filter((item: any) => item[key] === value);
        });
      }

      if (callback) callback({ data, error: null });
      return { data, error: null };
    },
  };
};

export const supabase = createMockSupabase() as any;
