import { Feature } from '@pos/shared-types';
import { cleanup, screen } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { signIn } from '../test/api-stub';
import { renderWithProviders } from '../test/render';
import { RequireModule } from './require-module';

afterEach(cleanup);

const routes = (
  <Routes>
    <Route element={<RequireModule features={[Feature.TABLES]} />}>
      <Route path="/settings/tables" element={<p>Floor plan</p>} />
    </Route>
  </Routes>
);

describe('module pages', () => {
  it('open where the module is on', async () => {
    signIn();
    await renderWithProviders(routes, { route: '/settings/tables' });
    expect(screen.getByText('Floor plan')).toBeInTheDocument();
  });

  it('say the module is off, with a way to the Modules page', async () => {
    signIn();
    await renderWithProviders(routes, { route: '/settings/tables', features: { TABLES: false } });
    expect(screen.queryByText('Floor plan')).not.toBeInTheDocument();
    expect(screen.getByText('This module is off')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open modules' })).toHaveAttribute(
      'href',
      '/settings/modules',
    );
  });
});
