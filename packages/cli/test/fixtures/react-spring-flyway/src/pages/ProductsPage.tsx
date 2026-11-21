import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { Product } from '../types/product';

export function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const { register, handleSubmit } = useForm<Product>();

  useEffect(() => {
    fetch('/api/products')
      .then((response) => response.json())
      .then(setProducts);

    // Rota inexistente no Spring: R4.
    fetch('/api/categories').then((response) => response.json());
  }, []);

  const onSubmit = handleSubmit(async (values) => {
    await fetch('/api/products', {
      method: 'POST',
      body: JSON.stringify({ name: values.name, price: values.price, stock: values.stock }),
    });
  });

  return (
    <form onSubmit={onSubmit}>
      <p>{products.length} produto(s)</p>
      <input {...register('name')} />
      <input name="price" />
      <input name="stock" />
      <input name="sku" />
      <input name="displayName" />
    </form>
  );
}
