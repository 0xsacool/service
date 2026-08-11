// Patterns for <Route path> declarations (App.tsx only).
export const ROUTE_PATTERNS = {
  home: '/',
  login: '/login',
  dashboard: '/dashboard',
  serviceJobs: '/service-jobs',
  newServiceJob: '/service-jobs/new',
  serviceJobDetails: '/service-jobs/:id',
  trackLookup: '/track',
  track: '/track/:trackingNumber',
  masterDataProducts: '/master-data/products',
  masterDataProductDetail: '/master-data/products/:id',
} as const;

// Concrete paths / builders for navigate() and <Link to>.
export const ROUTES = {
  home: '/',
  login: '/login',
  dashboard: '/dashboard',
  serviceJobs: '/service-jobs',
  newServiceJob: '/service-jobs/new',
  serviceJobDetails: (id: string) => `/service-jobs/${id}`,
  trackLookup: '/track',
  track: (trackingNumber: string) => `/track/${trackingNumber}`,
  masterDataProducts: '/master-data/products',
  masterDataProductDetail: (id: string) => `/master-data/products/${id}`,
} as const;
