import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { PageShell } from './page-shell';

const nav = [
  {
    id: 'overview',
    label: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: <svg data-testid="icon-dashboard" /> },
      { to: '/reports', label: 'Reports', icon: <svg /> },
    ],
  },
  {
    id: 'catalog',
    label: 'Catalog',
    items: [{ to: '/menu', label: 'Menu', icon: <svg /> }],
  },
];

function shell(route = '/') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <PageShell
        brand={<div>Brand switcher</div>}
        nav={nav}
        header={<div>Header slot</div>}
        skipLabel="Skip to content"
        navLabel="Main"
      >
        <p>Page body</p>
      </PageShell>
    </MemoryRouter>,
  );
}

afterEach(() => {
  // Vitest globals are off, so Testing Library cannot unmount between tests by itself.
  cleanup();
  window.localStorage.clear();
});

describe('PageShell', () => {
  it('renders a skip link to the main region and the slots', () => {
    shell();
    const skip = screen.getByRole('link', { name: 'Skip to content' });
    expect(skip).toHaveAttribute('href', '#main');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
    expect(screen.getByText('Brand switcher')).toBeInTheDocument();
    expect(screen.getByText('Header slot')).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByText('Page body')).toBeInTheDocument();
  });

  it('marks the active item and only that one', () => {
    shell('/reports');
    expect(screen.getByRole('link', { name: 'Reports' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
    expect(screen.getByTestId('icon-dashboard')).toBeInTheDocument();
  });

  it('marks a parent item active below it, unless the item is `end`', () => {
    const withParent = (end: boolean) => (
      <MemoryRouter initialEntries={['/org/1/reports']}>
        <PageShell
          brand={null}
          nav={[
            {
              label: 'Org',
              items: [
                { to: '/org/1', label: 'Overview', icon: <svg />, end },
                { to: '/org/1/reports', label: 'Reports', icon: <svg /> },
              ],
            },
          ]}
          header={null}
          skipLabel="Skip"
          navLabel="Main"
        >
          <p>Body</p>
        </PageShell>
      </MemoryRouter>
    );
    const first = render(withParent(false));
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
    first.unmount();
    render(withParent(true));
    expect(screen.getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Reports' })).toHaveAttribute('aria-current', 'page');
  });

  it('collapses a group and remembers it', async () => {
    const view = shell();
    const toggle = screen.getByRole('button', { name: 'Catalog' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'Menu' })).toBeVisible();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: 'Menu' })).toBeNull();
    // The other group is untouched.
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeVisible();

    view.unmount();
    shell();
    expect(screen.getByRole('button', { name: 'Catalog' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Catalog' }));
    expect(screen.getByRole('link', { name: 'Menu' })).toBeVisible();
  });

  it('keeps working when storage throws', async () => {
    const real = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked');
      },
    });
    try {
      shell();
      await userEvent.click(screen.getByRole('button', { name: 'Catalog' }));
      expect(screen.queryByRole('link', { name: 'Menu' })).toBeNull();
    } finally {
      Object.defineProperty(window, 'localStorage', real);
    }
  });
});
