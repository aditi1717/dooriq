import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { isModuleAuthenticated } from "@food/utils/auth";
import { restaurantAPI } from "@food/api";

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
  const isRestaurantRoute = requiredRole === "restaurant";
  const [isSubscriptionCheckDone, setIsSubscriptionCheckDone] = useState(!isRestaurantRoute);
  const [serverRequiresPayment, setServerRequiresPayment] = useState(false);

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

  useEffect(() => {
    let active = true;
    const allowedPaths = [
      "/food/restaurant/onboarding-payment",
      "/food/restaurant/onboarding",
      "/food/restaurant/pending-verification",
    ];

    if (!isRestaurantRoute || !isAuthenticated || allowedPaths.includes(location.pathname)) {
      setIsSubscriptionCheckDone(true);
      setServerRequiresPayment(false);
      return () => {
        active = false;
      };
    }

    // Keep current UI mounted during route-to-route checks to avoid white flashes
    // when switching tabs inside restaurant module.
    const syncRestaurantSubscription = async () => {
      try {
        const [restaurantResult, featureResult] = await Promise.allSettled([
          restaurantAPI.getCurrentRestaurant(),
          restaurantAPI.getFeatureSettingsPublic(),
        ]);
        const response =
          restaurantResult.status === "fulfilled" ? restaurantResult.value : null;
        const featureRes =
          featureResult.status === "fulfilled" ? featureResult.value : null;

        const cachedUserStr = localStorage.getItem("restaurant_user");
        let cachedUser = null;
        if (cachedUserStr) {
          try { cachedUser = JSON.parse(cachedUserStr); } catch (_) { /* ignore */ }
        }

        const restaurant =
          response?.data?.data?.restaurant ||
          response?.data?.restaurant ||
          (response?.data?.data && typeof response.data.data === "object" ? response.data.data : null) ||
          cachedUser ||
          null;

        // If restaurant payload is not available at all, fallback to cached status
        if (!restaurant) {
          if (active) {
            const featureEnabled = localStorage.getItem("restaurant_subscription_feature_enabled") !== "false";
            const onboardingFeePaid = Boolean(cachedUser?.onboardingFeePaid);
            setServerRequiresPayment(featureEnabled && !onboardingFeePaid);
          }
          return;
        }

        if (restaurant && response?.data) {
          localStorage.setItem("restaurant_user", JSON.stringify(restaurant));
        }

        const rows = Array.isArray(featureRes?.data?.data) ? featureRes.data.data : [];
        const feature = rows.find((row) => row.key === "restaurant_subscription");
        const subscriptionFeatureEnabled = feature ? Boolean(feature.isEnabled) : true;
        localStorage.setItem("restaurant_subscription_feature_enabled", String(subscriptionFeatureEnabled));

        const onboardingFeePaid = Boolean(restaurant?.onboardingFeePaid);
        const expiryRaw = restaurant?.subscriptionValidTill;
        const expiryMs = expiryRaw ? new Date(expiryRaw).getTime() : NaN;
        const isExpired = Number.isFinite(expiryMs) && expiryMs < Date.now();
        const shouldBlock = subscriptionFeatureEnabled && (!onboardingFeePaid || isExpired);

        if (active) {
          setServerRequiresPayment(shouldBlock);
        }
      } catch {
        if (active) {
          const cachedUserStr = localStorage.getItem("restaurant_user");
          if (cachedUserStr) {
            try {
              const cachedUser = JSON.parse(cachedUserStr);
              const onboardingFeePaid = Boolean(cachedUser?.onboardingFeePaid);
              const featureEnabled = localStorage.getItem("restaurant_subscription_feature_enabled") !== "false";
              setServerRequiresPayment(featureEnabled && !onboardingFeePaid);
              return;
            } catch (_) { /* ignore */ }
          }
          setServerRequiresPayment(false);
        }
      } finally {
        if (active) {
          setIsSubscriptionCheckDone(true);
        }
      }
    };

    syncRestaurantSubscription();
    return () => {
      active = false;
    };
  }, [isRestaurantRoute, isAuthenticated, location.pathname]);

  if (isRestaurantRoute) {
    if (!isSubscriptionCheckDone) {
      return null;
    }
    if (serverRequiresPayment) {
      return <Navigate to="/food/restaurant/onboarding-payment" replace />;
    }
  }

  return children;
}
