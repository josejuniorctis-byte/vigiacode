import { describe, expect, it } from 'vitest';
import { frontendExtractor } from './frontend.js';
import { extractFile } from './index.js';

const PAGE = `
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';

interface User {
  id: number;
  name: string;
  email: string;
  phone?: string;
}

export function UsersPage() {
  const { register } = useForm<User>();

  useEffect(() => {
    fetch('/api/users').then((response) => response.json());
    fetch('/api/users', {
      method: 'POST',
      body: JSON.stringify({ name: 'Ana', email: 'ana@example.com', phone: '1' }),
    });
    axios.get('/api/users/42');
  }, []);

  return (
    <form>
      <input name="name" />
      <input name="email" />
      <input {...register('phone')} />
    </form>
  );
}
`;

describe('frontend extractor', () => {
  const output = frontendExtractor.extract({
    projectRoot: '/tmp/project',
    file: 'src/pages/UsersPage.tsx',
    content: PAGE,
  });

  it('extrai interface/entidade e campos com tipo e opcional', () => {
    const user = output.entities.find((entity) => entity.name === 'user');
    expect(user).toBeDefined();
    expect(user?.fields.map((field) => field.name)).toEqual(
      expect.arrayContaining(['id', 'name', 'email', 'phone']),
    );
    const phone = user?.fields.find((field) => field.name === 'phone');
    expect(phone?.optional).toBe(true);
    expect(phone?.type).toBe('string');
  });

  it('extrai campos de formulário (name e register)', () => {
    const user = output.entities.find((entity) => entity.name === 'user');
    expect(user?.fields.map((field) => field.name)).toEqual(
      expect.arrayContaining(['name', 'email', 'phone']),
    );
  });

  it('extrai chamadas fetch/axios com método e rota normalizada', () => {
    expect(output.calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'GET', path: '/api/users', entity: 'user' }),
        expect.objectContaining({ method: 'POST', path: '/api/users', entity: 'user' }),
        expect.objectContaining({ method: 'GET', path: '/api/users/:param' }),
      ]),
    );
  });

  it('extrai campos do payload enviado', () => {
    const user = output.entities.find((entity) => entity.name === 'user');
    expect(user?.fields.map((field) => field.name)).toEqual(
      expect.arrayContaining(['name', 'email', 'phone']),
    );
  });

  it('detecta rotas JSX e componentes usados', () => {
    const app = frontendExtractor.extract({
      projectRoot: '/tmp/project',
      file: 'src/App.tsx',
      content: `
        import { UsersPage } from './pages/UsersPage';
        export function App() {
          return <Route path="/users" element={<UsersPage />} />;
        }
      `,
    });
    expect(app.routes).toEqual([
      expect.objectContaining({ path: '/users', component: 'UsersPage' }),
    ]);
    expect(app.jsx).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'UsersPage' })]),
    );
  });

  it('marca arquivos de mock e uso de localStorage', () => {
    const [mock] = extractFile({
      projectRoot: '/tmp/project',
      file: 'src/mocks/users.ts',
      content: 'export const users = [{ id: 1, name: "Ana" }];',
    });
    expect(mock?.mockFile).toBe(true);

    const page = frontendExtractor.extract({
      projectRoot: '/tmp/project',
      file: 'src/pages/UsersPage.tsx',
      content: 'localStorage.setItem("users", "[]");',
    });
    expect(page.localStorage).toBe(true);
  });
});
