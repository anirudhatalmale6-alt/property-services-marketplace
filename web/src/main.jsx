import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import './styles.css';

import { AuthProvider, useAuth, homeFor } from './lib/auth.jsx';
import Layout from './components/Layout.jsx';
import { Loading } from './components/ui.jsx';

import Home from './pages/Home.jsx';
import Book from './pages/Book.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Orders from './pages/Orders.jsx';
import OrderDetail from './pages/OrderDetail.jsx';

import Onboarding from './pages/provider/Onboarding.jsx';
import JobBoard from './pages/provider/JobBoard.jsx';
import MyJobs from './pages/provider/MyJobs.jsx';
import ProviderJobDetail from './pages/provider/JobDetail.jsx';
import Earnings from './pages/provider/Earnings.jsx';

import AdminDashboard from './pages/admin/Dashboard.jsx';
import AdminJobs from './pages/admin/Jobs.jsx';
import AdminJobDetail from './pages/admin/JobDetail.jsx';
import AdminProviders from './pages/admin/Providers.jsx';
import AdminProviderDetail from './pages/admin/ProviderDetail.jsx';
import AdminCustomers from './pages/admin/Customers.jsx';
import AdminMoney from './pages/admin/Money.jsx';
import AdminExceptions from './pages/admin/Exceptions.jsx';
import AdminCoverage from './pages/admin/Coverage.jsx';

/**
 * Route guard.
 *
 * This is convenience and clarity only — every endpoint enforces its own
 * authorisation server-side. Hiding a page is never what keeps data safe.
 */
function Require({ roles, children, approvedProvider = false }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Loading label="Checking your session" />;

  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  if (roles && !roles.includes(user.role)) {
    return <Navigate to={homeFor(user)} replace />;
  }

  // A provider who isn't approved yet belongs in onboarding, not on the board.
  if (approvedProvider && user.provider?.status !== 'APPROVED') {
    return <Navigate to="/provider/onboarding" replace />;
  }

  return children;
}

/** Signed-in users shouldn't sit on the login page. */
function GuestOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading label="Loading" />;
  if (user) return <Navigate to={homeFor(user)} replace />;
  return children;
}

function NotFound() {
  const { user } = useAuth();
  return (
    <div className="text-center py-20">
      <p className="ref text-[var(--color-ink-3)] mb-2">404</p>
      <h1 className="text-3xl mb-3">That page doesn&apos;t exist</h1>
      <a href={homeFor(user)} className="btn btn-primary">
        Back to the start
      </a>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route element={<Layout />}>
            {/* -------------------------------------------------- public */}
            <Route path="/" element={<Home />} />
            <Route path="/book" element={<Book />} />
            <Route
              path="/login"
              element={
                <GuestOnly>
                  <Login />
                </GuestOnly>
              }
            />
            <Route
              path="/register"
              element={
                <GuestOnly>
                  <Register />
                </GuestOnly>
              }
            />

            {/* ------------------------------------------------ customer */}
            <Route
              path="/orders"
              element={
                <Require roles={['CUSTOMER', 'ADMIN']}>
                  <Orders />
                </Require>
              }
            />
            <Route
              path="/orders/:id"
              element={
                <Require roles={['CUSTOMER', 'ADMIN']}>
                  <OrderDetail />
                </Require>
              }
            />

            {/* ------------------------------------------------ provider */}
            <Route
              path="/provider/onboarding"
              element={
                <Require roles={['PROVIDER']}>
                  <Onboarding />
                </Require>
              }
            />
            <Route
              path="/provider/jobs"
              element={
                <Require roles={['PROVIDER']} approvedProvider>
                  <JobBoard />
                </Require>
              }
            />
            <Route
              path="/provider/mine"
              element={
                <Require roles={['PROVIDER']} approvedProvider>
                  <MyJobs />
                </Require>
              }
            />
            <Route
              path="/provider/jobs/:id"
              element={
                <Require roles={['PROVIDER']} approvedProvider>
                  <ProviderJobDetail />
                </Require>
              }
            />
            <Route
              path="/provider/earnings"
              element={
                <Require roles={['PROVIDER']} approvedProvider>
                  <Earnings />
                </Require>
              }
            />

            {/* --------------------------------------------------- admin */}
            <Route
              path="/admin"
              element={
                <Require roles={['ADMIN']}>
                  <AdminDashboard />
                </Require>
              }
            />
            <Route
              path="/admin/jobs"
              element={
                <Require roles={['ADMIN']}>
                  <AdminJobs />
                </Require>
              }
            />
            <Route
              path="/admin/jobs/:id"
              element={
                <Require roles={['ADMIN']}>
                  <AdminJobDetail />
                </Require>
              }
            />
            <Route
              path="/admin/providers"
              element={
                <Require roles={['ADMIN']}>
                  <AdminProviders />
                </Require>
              }
            />
            <Route
              path="/admin/providers/:id"
              element={
                <Require roles={['ADMIN']}>
                  <AdminProviderDetail />
                </Require>
              }
            />
            <Route
              path="/admin/customers"
              element={
                <Require roles={['ADMIN']}>
                  <AdminCustomers />
                </Require>
              }
            />
            <Route
              path="/admin/money"
              element={
                <Require roles={['ADMIN']}>
                  <AdminMoney />
                </Require>
              }
            />
            <Route
              path="/admin/exceptions"
              element={
                <Require roles={['ADMIN']}>
                  <AdminExceptions />
                </Require>
              }
            />
            <Route
              path="/admin/areas"
              element={
                <Require roles={['ADMIN']}>
                  <AdminCoverage />
                </Require>
              }
            />

            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
