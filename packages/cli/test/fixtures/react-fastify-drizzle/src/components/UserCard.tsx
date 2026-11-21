import type { User } from '../types/user';

export function UserCard({ user }: { user?: User }) {
  if (!user) return null;
  return (
    <article>
      <h2>{user.name}</h2>
      <p>{user.email}</p>
    </article>
  );
}
