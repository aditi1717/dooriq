import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { isModuleAuthenticated } from "@food/utils/auth";

/**
 * Role-based Protected Route Component
 * Only allows access if user is authenticated for the specific module
 */
export default function ProtectedRoute({ children, requiredRole, loginPath = "/food/user/auth/login" }) {
  const location = useLocation();

  // If no role required, allow access
  if (!requiredRole) {
    return children;
  }

  const isAuthenticated = isModuleAuthenticated(requiredRole);
  const [authFailedEvent, setAuthFailedEvent] = useState(false);

  useEffect(() => {
    const handleAuthFailure = (e) => {
      if (e.detail?.module === requiredRole) {
        setAuthFailedEvent(true);
      }
    };
    window.addEventListener("authRefreshFailed", handleAuthFailure);
    return () => window.removeEventListener("authRefreshFailed", handleAuthFailure);
  }, [requiredRole]);

  // If not authenticated for this module, redirect to login
  if (!isAuthenticated || authFailedEvent) {
    return <Navigate to={loginPath} state={{ from: location.pathname }} replace />;
  }

  return children;
}
