import { cn } from '@pos/ui';
import { type ReactNode, useCallback, useId, useState } from 'react';
import { NavLink } from 'react-router';

export interface PageShellNavItem {
  to: string;
  label: string;
  icon: ReactNode;
}

export interface PageShellNavGroup {
  /** Keys the remembered collapsed state; defaults to the label (which changes with the language). */
  id?: string;
  label: string;
  items: PageShellNavItem[];
}

const COLLAPSED_KEY = 'madar.shell.collapsed-groups';

function readCollapsed(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(COLLAPSED_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * The console page frame (ADR 0028): a skip link, a sidebar with the brand switcher on top and
 * collapsible nav groups (remembered on this device), a header bar and the `main` region the skip
 * link jumps to. Strings come from props so apps translate them. The sidebar only uses logical
 * utilities, so `dir="rtl"` mirrors it.
 */
export function PageShell({
  brand,
  nav,
  header,
  children,
  skipLabel,
  navLabel,
}: {
  /** The brand/location switcher slot, at the top of the sidebar. */
  brand: ReactNode;
  nav: PageShellNavGroup[];
  /** The header bar (user menu, language, theme). */
  header: ReactNode;
  children: ReactNode;
  /** Text of the skip link ("Skip to content"). */
  skipLabel: string;
  /** Accessible name of the navigation landmark. */
  navLabel: string;
}) {
  const baseId = useId();
  const [collapsed, setCollapsed] = useState<string[]>(readCollapsed);

  const toggle = useCallback((key: string) => {
    setCollapsed((current) => {
      const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
      try {
        window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
      } catch {
        // Storage can be blocked; the groups still collapse for this visit.
      }
      return next;
    });
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground md:flex-row">
      <a
        href="#main"
        className={cn(
          'sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-toast',
          'focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-body-sm',
          'focus:font-medium focus:text-primary-foreground focus:shadow-2',
        )}
      >
        {skipLabel}
      </a>
      <aside
        className={cn(
          'flex shrink-0 flex-col gap-3 border-b bg-surface p-3',
          'md:sticky md:top-0 md:h-screen md:w-64 md:overflow-y-auto md:border-b-0 md:border-e',
        )}
      >
        <div>{brand}</div>
        <nav aria-label={navLabel} className="flex flex-col gap-2">
          {nav.map((group, index) => {
            const key = group.id ?? group.label;
            const open = !collapsed.includes(key);
            const listId = `${baseId}-group-${index}`;
            return (
              <div key={key}>
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={listId}
                  onClick={() => {
                    toggle(key);
                  }}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5',
                    'text-caption font-semibold uppercase tracking-wide text-muted-foreground',
                    'outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
                  )}
                >
                  <span>{group.label}</span>
                  <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={cn(
                      'size-4 shrink-0 transition-transform duration-fast',
                      !open && '-rotate-90 rtl:rotate-90',
                    )}
                    aria-hidden="true"
                  >
                    <path d="m4 6 4 4 4-4" />
                  </svg>
                </button>
                <ul id={listId} hidden={!open} className="mt-1 flex flex-col gap-0.5">
                  {group.items.map((item) => (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.to === '/'}
                        className={({ isActive }) =>
                          cn(
                            'flex h-9 items-center gap-2 rounded-md px-2 text-body-sm font-medium',
                            'outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            isActive
                              ? 'bg-primary-subtle text-foreground'
                              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                          )
                        }
                      >
                        <span
                          className="flex size-(--icon-size) shrink-0 items-center justify-center"
                          aria-hidden="true"
                        >
                          {item.icon}
                        </span>
                        <span className="truncate">{item.label}</span>
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-header flex min-h-14 items-center justify-end gap-2 border-b bg-surface px-4 shadow-1">
          {header}
        </header>
        <main id="main" tabIndex={-1} className="flex-1 p-4 outline-none md:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
