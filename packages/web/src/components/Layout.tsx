import { Outlet } from 'react-router-dom';
import { Header } from './Header';
import { MobileNav, Sidebar } from './Sidebar';

export function Layout() {
  return (
    <div className="relative min-h-screen">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(60%_100%_at_50%_0%,var(--accent-soft),transparent_70%)]"
        aria-hidden="true"
      />
      <Header />
      <div className="relative mx-auto flex max-w-[1500px] gap-6 px-4 py-6 sm:px-6">
        <Sidebar />
        <main className="min-w-0 flex-1 pb-16">
          <MobileNav />
          <Outlet />
        </main>
      </div>
    </div>
  );
}
