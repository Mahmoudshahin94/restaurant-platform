import { BrowserRouter, Route, Routes } from 'react-router';
import { SiteShell } from './components/site-shell';
import { CartPage } from './routes/cart-page';
import { CheckoutPage } from './routes/checkout-page';
import { ConfirmationPage } from './routes/confirmation-page';
import { LandingPage } from './routes/landing-page';
import { MenuPage } from './routes/menu-page';
import { NotFoundPage } from './routes/not-found-page';
import { TrackPage } from './routes/track-page';

export function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<SiteShell />}>
          <Route index element={<LandingPage />} />
          <Route path="/l/:locationId" element={<MenuPage />} />
          <Route path="/l/:locationId/cart" element={<CartPage />} />
          <Route path="/l/:locationId/checkout" element={<CheckoutPage />} />
          <Route path="/confirmation/:token" element={<ConfirmationPage />} />
          <Route path="/track/:token" element={<TrackPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
