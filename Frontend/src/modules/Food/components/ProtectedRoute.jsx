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

  // If not authenticated for this module, redirect to login
  if (!isAuthenticated) {
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

        const restaurant =
          response?.data?.data?.restaurant ||
          response?.data?.restaurant ||
          null;

        // If restaurant payload is not available, keep access blocked until next successful sync.
        if (!restaurant) {
          if (active) {
            setServerRequiresPayment(true);
          }
          return;
        }
        if (restaurant) {
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
          setServerRequiresPayment(true);
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
