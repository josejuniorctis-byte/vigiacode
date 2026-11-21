'use client';

import { useEffect, useState } from 'react';
import { UserForm } from './UserForm';
import type { User } from './types';

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);

  useEffect(() => {
    fetch('/api/users')
      .then((response) => response.json())
      .then(setUsers);

    fetch('/api/users', {
      method: 'POST',
      body: JSON.stringify({ name: 'Ana', email: 'ana@example.com', phone: '11999999999' }),
    }).then((response) => response.json());

    // Endpoint que não existe: R4.
    fetch('/api/checkout', { method: 'POST' }).then((response) => response.json());
  }, []);

  return (
    <main>
      <UserForm />
      <input name="name" />
      <input name="email" />
      <input name="phone" />
      <input name="role" />
      <ul>
        {users.map((user) => (
          <li key={user.id}>{user.name}</li>
        ))}
      </ul>
    </main>
  );
}
