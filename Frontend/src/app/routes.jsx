import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Suspense, lazy, useEffect, useState } from 'react'
import Loader from '@food/components/Loader'
import LaunchLandingPage from './LaunchLandingPage'
import { adminAPI } from '@/services/api'
import { registerWebPushForCurrentModule } from '@food/utils/firebaseMessaging'

const NATIVE_LAST_ROUTE_KEY = 'native_last_route'

// Lazy load the Food service module (Quick-spicy app)
const FoodApp = lazy(() => import('../modules/Food/routes'))
const AuthApp = lazy(() => import('../modules/auth/routes'))
import ProtectedRoute from '@food/components/ProtectedRoute'

const PageLoader = () => <Loader />

/**
 * FoodAppWrapper — Quick-spicy App. को /food prefix के साथ render करता है.
 * 
 * Quick-spicy की App.jsx में routes /restaurant, /usermain, /admin, /delivery
 * जैसे hain (bina /food prefix ke). Yahan hum useLocation se /food ke baad wala
 * path nikalne ke baad FoodApp render karte hain. FoodApp internally BrowserRouter
 * nahi use karta (sirf Routes use karta hai), isliye ye directly kaam karta hai.
 */
const FoodAppWrapper = () => {
  return (
    <Suspense fallback={<PageLoader />}>
      <FoodApp />
    </Suspense>
  )
}

const RedirectToFood = () => {
  const location = useLocation();
  // We safely replace the exact current pathname with a /food prefixed pathname
  // This effectively catches programmatic navigation to absolute paths like '/restaurant/login'
  // and turns them into '/food/restaurant/login'
  return <Navigate to={`/food${location.pathname}${location.search}`} state={location.state} replace />;
};

const parseFeatureEnabled = (value, fallback = true) => {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }
  if (typeof value === 'number') {
    if (value === 1) return true
    if (value === 0) return false
  }
  return fallback
}

const RootEntryRoute = () => {
  const [rootLandingEnabled, setRootLandingEnabled] = useState(null)

  useEffect(() => {
    let isCancelled = false

    const loadRootLandingSetting = async () => {
      try {
        const response = await adminAPI.getFeatureSettingsPublic()
        const rows = Array.isArray(response?.data?.data) ? response.data.data : []
        const setting = rows.find((item) => item.key === 'root_landing_and_unregistered_control')
        const enabled = parseFeatureEnabled(setting?.isEnabled, true)
        if (!isCancelled) {
          setRootLandingEnabled(enabled)
        }
      } catch {
        if (!isCancelled) {
          setRootLandingEnabled(true)
        }
      }
    }

    loadRootLandingSetting()

    return () => {
      isCancelled = true
    }
  }, [])

  // Redirect back to the last active module when returning to root "/"
  if (typeof window !== 'undefined') {
    const lastModule = sessionStorage.getItem('last_active_module')
    if (lastModule === 'delivery') {
      return <Navigate to="/food/delivery" replace />
    }
    if (lastModule === 'restaurant') {
      return <Navigate to="/food/restaurant" replace />
    }
    if (lastModule === 'user' || sessionStorage.getItem('entered_food_app') === 'true') {
      return <Navigate to="/food/user" replace />
    }
  }

  if (rootLandingEnabled === null) {
    return <PageLoader />
  }

  if (!rootLandingEnabled) {
    return <Navigate to="/food/user" replace />
  }

  return <LaunchLandingPage />
}


const AdminRouter = lazy(() => import('../modules/Food/components/admin/AdminRouter'))
const ReferralInvitePage = lazy(() => import('./ReferralInvitePage'))
const DeliveryReferralInvitePage = lazy(() => import('./DeliveryReferralInvitePage'))

const AppRoutes = () => {
  const location = useLocation()

  useEffect(() => {
    if (typeof window !== 'undefined') return

    const protocol = String(window.location?.protocol || '').toLowerCase()
    const userAgent = String(window.navigator?.userAgent || '').toLowerCase()
    const isNativeLikeShell =
      Boolean(window.flutter_inappwebview) ||
      Boolean(window.ReactNativeWebView) ||
      protocol === 'file:' ||
      userAgent.includes(' wv') ||
      userAgent.includes('; wv')

    if (!isNativeLikeShell) return

    const route = `${location.pathname || ''}${location.search || ''}`
    if (route.startsWith('/food/') || route.startsWith('/admin')) {
      localStorage.setItem(NATIVE_LAST_ROUTE_KEY, route)
    }
  }, [location.pathname, location.search])

  useEffect(() => {
    if (!location.pathname.startsWith('/admin')) return
    registerWebPushForCurrentModule(location.pathname)
  }, [location.pathname])


  return (
    <Routes>
      {/* Root → Redirect directly to Food Homepage */}
      <Route path="/" element={<RootEntryRoute />} />
      <Route path="/launch-aug-15" element={<LaunchLandingPage />} />
      <Route path="/invite" element={<ReferralInvitePage />} />
      <Route path="/invite/delivery" element={<DeliveryReferralInvitePage />} />
      {/* Food Module */}
      <Route path="/food/*" element={<FoodAppWrapper />} />

      {/* Global Admin Portal - AdminRouter handles its own protection for sub-routes */}
      <Route
        path="/admin/*"
        element={
          <Suspense fallback={<PageLoader />}>
            <AdminRouter />
          </Suspense>
        }
      />
      
      {/* Dynamic intercept redirects for bare paths (accessed programmatically) */}
      <Route path="/user/*" element={<RedirectToFood />} />
      <Route path="/restaurant/*" element={<RedirectToFood />} />
      <Route path="/delivery/*" element={<RedirectToFood />} />
      <Route path="/usermain/*" element={<RedirectToFood />} />
      <Route path="/profile/*" element={<RedirectToFood />} />
      <Route path="/cart/*" element={<Navigate to="/food/user/cart" replace />} />
      <Route path="/orders/*" element={<RedirectToFood />} />

      {/* Fallback 404 */}
      <Route path="*" element={<Navigate to="/food/user" replace />} />
    </Routes>
  )
}

export default AppRoutes
