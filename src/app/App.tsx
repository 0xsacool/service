import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { TrackHome } from '../features/tracking/pages/TrackHome';
import { TrackResult } from '../features/tracking/pages/TrackResult';
import { Login } from '../features/auth/pages/Login';
import { Dashboard } from '../features/dashboard/pages/Dashboard';
import { ServiceJobsList } from '../features/service-jobs/pages/ServiceJobsList';
import { NewServiceJob } from '../features/service-jobs/pages/NewServiceJob';
import { ServiceJobDetails } from '../features/service-jobs/pages/ServiceJobDetails';
import { ProductsPage } from '../features/master-data/products/pages/ProductsPage';
import { ProductDetail } from '../features/master-data/products/pages/ProductDetail';
import { StaffLayout } from '../shared/layouts/StaffLayout';
import { NotFoundPage } from '../shared/components';
import { ROUTE_PATTERNS } from '../constants';
import { AuthSessionProvider } from '../auth/AuthSessionProvider';
import { StaffRouteGuard } from '../auth/StaffRouteGuard';
import { backendConfiguration, combineBackendConfigurations } from '../config/backend';
import { filesBackendConfiguration } from '../config/filesBackend';
import { filesWorkerUrlConfiguration } from '../config/workerUrl';
import { BackendConfigurationGate } from './BackendConfigurationGate';

const appConfiguration = combineBackendConfigurations(
  backendConfiguration,
  filesBackendConfiguration,
  filesWorkerUrlConfiguration
);

export default function App() {
  return (
    <BackendConfigurationGate configuration={appConfiguration}>
      <AuthSessionProvider>
        <BrowserRouter>
          <Routes>
            {/* Public */}
            <Route path={ROUTE_PATTERNS.home} element={<TrackHome />} />
            <Route path={ROUTE_PATTERNS.trackLookup} element={<TrackResult />} />
            <Route path={ROUTE_PATTERNS.track} element={<TrackResult />} />
            <Route path={ROUTE_PATTERNS.login} element={<Login />} />

            {/* Staff (wrapped in shell) */}
            <Route element={<StaffRouteGuard />}>
              <Route element={<StaffLayout />}>
                <Route path={ROUTE_PATTERNS.dashboard} element={<Dashboard />} />
                <Route path={ROUTE_PATTERNS.serviceJobs} element={<ServiceJobsList />} />
                <Route path={ROUTE_PATTERNS.newServiceJob} element={<NewServiceJob />} />
                <Route
                  path={ROUTE_PATTERNS.serviceJobDetails}
                  element={<ServiceJobDetails />}
                />
                <Route
                  path={ROUTE_PATTERNS.masterDataProducts}
                  element={<ProductsPage />}
                />
                <Route
                  path={ROUTE_PATTERNS.masterDataProductDetail}
                  element={<ProductDetail />}
                />
              </Route>
            </Route>

            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </BrowserRouter>
      </AuthSessionProvider>
    </BackendConfigurationGate>
  );
}
