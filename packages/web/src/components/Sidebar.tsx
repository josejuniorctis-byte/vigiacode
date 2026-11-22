import { NavLink } from 'react-router-dom';
import { useBindingsSummary } from '../api/hooks';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  end?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Linha do tempo', icon: '◷', end: true },
  { to: '/agenda', label: 'Agenda de Evolução', icon: '▦' },
  { to: '/files', label: 'Arquivos', icon: '▤' },
  { to: '/bindings', label: 'Amarrações', icon: '∞' },
  { to: '/architect', label: 'Arquiteto', icon: '◇' },
  { to: '/settings', label: 'Configurações', icon: '⚙' },
];

function linkClass({ isActive }: { isActive: boolean }): string {
  return `nav-link ${isActive ? 'nav-link-active' : ''}`;
}

export function Sidebar() {
  const summary = useBindingsSummary();
  const red = summary.data?.red ?? 0;

  return (
    <aside className="hidden w-56 shrink-0 lg:block">
      <nav className="sticky top-20 space-y-1" aria-label="Navegação principal">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={linkClass}>
            <span className="w-4 text-center text-base text-[var(--accent)]" aria-hidden="true">
              {item.icon}
            </span>
            {item.label}
            {item.to === '/bindings' && red > 0 ? (
              <span
                className="ml-auto rounded-full border border-rose-500/40 bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-bold text-rose-600 dark:text-rose-300"
                aria-label={`${red} amarração(ões) vermelha(s)`}
                title={`${red} amarração(ões) 🔴`}
              >
                {red}
              </span>
            ) : null}
          </NavLink>
        ))}
      </nav>

      <div className="sticky top-[22rem] mt-10 px-2 text-[11px] leading-relaxed text-[var(--muted)]">
        <p className="font-semibold text-[var(--text)]">VigiaCode</p>
        <p className="mt-1">Agenda de Evolução local.</p>
        <p className="mt-1 font-mono">localhost:4317</p>
      </div>
    </aside>
  );
}

export function MobileNav() {
  const summary = useBindingsSummary();
  const red = summary.data?.red ?? 0;

  return (
    <nav
      className="scroll-thin -mx-4 mb-5 flex gap-1 overflow-x-auto border-b border-[var(--border)] px-4 pb-2 lg:hidden"
      aria-label="Navegação principal"
    >
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            `whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium ${
              isActive
                ? 'bg-[var(--accent-soft)] text-[var(--text)]'
                : 'text-[var(--muted)] hover:text-[var(--text)]'
            }`
          }
        >
          {item.icon} {item.label}
          {item.to === '/bindings' && red > 0 ? (
            <span className="ml-1 rounded-full bg-rose-500/20 px-1.5 text-[10px] font-bold text-rose-600 dark:text-rose-300">
              {red}
            </span>
          ) : null}
        </NavLink>
      ))}
    </nav>
  );
}
