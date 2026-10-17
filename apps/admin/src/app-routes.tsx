import { RequireAuth } from '@pos/app-kit';
import { BrowserRouter, Route, Routes } from 'react-router';
import { session } from './lib/api';
import { AppShell } from './components/app-shell';
import { RequirePermission } from './components/require-permission';
import { DashboardPage } from './routes/dashboard-page';
import { LoginPage } from './routes/login-page';
import { AvailabilityPage } from './routes/menu/availability-page';
import { CategoriesPage } from './routes/menu/categories-page';
import { KitchenStationsPage } from './routes/menu/kitchen-stations-page';
import { ModifierGroupsPage } from './routes/menu/modifier-groups-page';
import { ProductsPage } from './routes/menu/products-page';
import { DiscountsPage } from './routes/settings/discounts-page';
import { TablesPage } from './routes/settings/tables-page';
import { TaxesPage } from './routes/settings/taxes-page';
import { NotFoundPage } from './routes/not-found-page';

export function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <RequireAuth session={session}>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="menu" element={<RequirePermission permission="products.view" />}>
            <Route path="categories" element={<CategoriesPage />} />
            <Route path="products" element={<ProductsPage />} />
            <Route path="modifier-groups" element={<ModifierGroupsPage />} />
            <Route path="kitchen-stations" element={<KitchenStationsPage />} />
            <Route path="availability" element={<AvailabilityPage />} />
          </Route>
          <Route path="settings">
            <Route path="taxes" element={<TaxesPage />} />
            <Route path="discounts" element={<DiscountsPage />} />
            <Route path="tables" element={<TablesPage />} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
