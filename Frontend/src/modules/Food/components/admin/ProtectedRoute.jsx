import { useEffect, useState } from "react"
import { Navigate, useLocation } from "react-router-dom"
import { adminAPI } from "@food/api"
import { clearModuleAuth, getCurrentUser, isModuleAuthenticated, setAuthData } from "@food/utils/auth"
import { canAccessAdminPath, findFirstAllowedAdminPath } from "@food/utils/adminRbac"

export default function ProtectedRoute({ children }) {
  const location = useLocation()
  const isAuthenticated = isModuleAuthenticated("admin")
  const [checking, setChecking] = useState(true)
  const [authError, setAuthError] = useState(false)

  useEffect(() => {
    let isMounted = true

    const syncAdminProfile = async () => {
      if (!isAuthenticated) {
        if (isMounted) setChecking(false)
        return
      }
      try {
        const res = await adminAPI.getCurrentAdmin()
        const user =
          res?.data?.data?.user ??
          res?.data?.user ??
          res?.data?.data ??
          res?.data
        const token = localStorage.getItem("admin_accessToken")
        const refreshToken = localStorage.getItem("admin_refreshToken")
        if (token && user) {
          setAuthData("admin", token, user, refreshToken)
          window.dispatchEvent(new Event("adminAuthChanged"))
        }
        if (isMounted) {
          setAuthError(false)
          setChecking(false)
        }
      } catch (_error) {
        clearModuleAuth("admin")
        if (isMounted) {
          setAuthError(true)
          setChecking(false)
        }
      }
    }

    syncAdminProfile()

    return () => {
      isMounted = false
    }
  }, [isAuthenticated, location.pathname])

  if (!isAuthenticated) {
    return <Navigate to="/admin/login" state={{ from: location.pathname }} replace />
  }
  if (authError) {
    return <Navigate to="/admin/login" state={{ from: location.pathname }} replace />
  }
  if (checking) {
    return <div className="min-h-screen bg-neutral-100" />
  }

  const adminUser = getCurrentUser("admin")
  if (!canAccessAdminPath(location.pathname, "view")) {
    return <Navigate to={findFirstAllowedAdminPath(adminUser)} replace />
  }

  return children
}
