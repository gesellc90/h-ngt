import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext.js';
import { ToastProvider } from './contexts/ToastContext.js';
import ProtectedRoute from './components/ProtectedRoute.js';
import Layout from './components/Layout.js';
import LoginPage from './pages/LoginPage.js';
import BookingPage from './pages/BookingPage.js';
import ThekePage from './pages/ThekePage.js';
import ProfilePage from './pages/ProfilePage.js';
import AdminLayout from './pages/admin/AdminLayout.js';
import MembersPage from './pages/admin/MembersPage.js';
import DrinksPage from './pages/admin/DrinksPage.js';
import CategoriesPage from './pages/admin/CategoriesPage.js';
import AdminBookingsPage from './pages/admin/BookingsPage.js';
import ReportPage from './pages/admin/ReportPage.js';
import VerbindungenPage from './pages/admin/VerbindungenPage.js';
import SystemPage from './pages/admin/SystemPage.js';
import ZeigerPage from './pages/ZeigerPage.js';
import ZeigerDetailPage from './pages/ZeigerDetailPage.js';
import StreichenPage from './pages/StreichenPage.js';

/** Theken-/Allgemein-Konten buchen für andere, alle übrigen für sich selbst. */
function BuchenRoute() {
  const { canBookForOthers } = useAuth();
  return canBookForOthers ? <ThekePage /> : <BookingPage />;
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <Routes>
          {/* Öffentliche Route */}
          <Route path="/login" element={<LoginPage />} />

          {/* Geschützte Routen — für alle eingeloggten User */}
          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route index element={<Navigate to="/buchen" replace />} />
              <Route path="/buchen" element={<BuchenRoute />} />
              <Route path="/zeiger" element={<ZeigerPage />} />
              <Route path="/zeiger/:id" element={<ZeigerDetailPage />} />
              <Route path="/profil" element={<ProfilePage />} />

              {/* Wirtschaftskommission — Konten streichen (WK oder Admin) */}
              <Route element={<ProtectedRoute role="wk" />}>
                <Route path="/wk" element={<StreichenPage />} />
              </Route>

              {/* Admin-Bereich — nur für Admins */}
              <Route element={<ProtectedRoute role="admin" />}>
                <Route path="/admin" element={<AdminLayout />}>
                  <Route index element={<Navigate to="/admin/mitglieder" replace />} />
                  <Route path="mitglieder" element={<MembersPage />} />
                  <Route path="getraenke" element={<DrinksPage />} />
                  <Route path="kategorien" element={<CategoriesPage />} />
                  <Route path="buchungen" element={<AdminBookingsPage />} />
                  <Route path="berichte" element={<ReportPage />} />
                  <Route path="verbindungen" element={<VerbindungenPage />} />
                  <Route path="system" element={<SystemPage />} />
                </Route>
              </Route>

              {/* Fallback */}
              <Route path="*" element={<Navigate to="/buchen" replace />} />
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </ToastProvider>
  );
}
