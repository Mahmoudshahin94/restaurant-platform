import { BrowserRouter, Route, Routes } from 'react-router';
import { AppShell } from './components/app-shell';
import { RequireAuth } from './components/require-auth';
import { RequirePermission } from './components/require-permission';
import { DashboardPage } from './routes/dashboard-page';
import { LoginPage } from './routes/login-page';
import { AvailabilityPage } from './routes/menu/availability-page';
import { CategoriesPage } from './routes/menu/categories-page';
import { KitchenStationsPage } from './routes/menu/kitchen-stations-page';
import { ModifierGroupsPage } from './routes/menu/modifier-groups-page';
import { ProductsPage } from './routes/menu/products-page';
import { NotFoundPage } from './routes/not-found-page';

export function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <RequireAuth>
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
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
