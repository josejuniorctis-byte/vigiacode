import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { UserCard } from '../components/UserCard';
import { MissingPanel } from '../components/MissingPanel';
import type { User } from '../types/user';

export function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const { register, handleSubmit } = useForm<User>();

  useEffect(() => {
    fetch('/api/users')
      .then((response) => response.json())
      .then(setUsers);

    // Rota que não existe no back-end: R4.
    fetch('/api/orders').then((response) => response.json());
  }, []);

  const onSubmit = handleSubmit(async (values) => {
    await fetch('/api/users', {
      method: 'POST',
      body: JSON.stringify({ name: values.name, email: values.email, phone: values.phone }),
    });
  });

  return (
    <form onSubmit={onSubmit}>
      <input name="name" />
      <input name="email" />
      <input name="phone" />
      <input {...register('role')} />
      <UserCard user={users[0]} />
      <MissingPanel />
    </form>
  );
}
