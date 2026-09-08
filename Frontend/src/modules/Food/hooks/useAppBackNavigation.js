import { useCallback } from "react"
import { useLocation, useNavigate } from "react-router-dom"

const toFoodPath = (value) => {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.startsWith("/food/")) return trimmed
  if (trimmed === "/food") return trimmed
  if (trimmed.startsWith("/user/")) return `/food${trimmed}`
  if (trimmed === "/user") return "/food/user"
  return null
}

const getNormalizedUserPath = (pathname) => {
  if (pathname.startsWith("/food")) {
    return pathname.slice(5) || "/"
  }
  return pathname || "/"
}

const resolveBackPath = ({ pathname, search, state }) => {
  const normalizedPath = getNormalizedUserPath(pathname)
  const explicitBackPath = toFoodPath(state?.backTo) || toFoodPath(state?.from)
  if (explicitBackPath && explicitBackPath !== pathname) {
    return explicitBackPath
  }
  const searchParams = new URLSearchParams(search || "")

  if (
    normalizedPath === "/user/profile/payments/new" ||
    /^\/user\/profile\/payments\/[^/]+\/edit$/.test(normalizedPath)
  ) {
    return "/food/user/profile/payments"
  }

  if (
    /^\/user\/profile\/(edit|favorites|support|coupons|about|report-safety-emergency|accessibility|logout|refer-earn|payments)$/.test(
      normalizedPath,
    )
  ) {
    return "/food/user/profile"
  }

  if (
    /^\/user\/profile\/(terms|privacy|refund|shipping|cancellation|help-content)$/.test(
      normalizedPath,
    )
  ) {
    return explicitBackPath || "/food/user/profile"
  }

  if (normalizedPath === "/user/wallet") {
    return "/food/user/profile"
  }

  if (normalizedPath === "/user/notifications") {
    return explicitBackPath || "/food/user"
  }

  if (/^\/user\/restaurants\/[^/]+$/.test(normalizedPath)) {
    if (searchParams.get("switch99") === "true" || searchParams.get("under250") === "true") {
      return "/food/user/switch-99"
    }
    return explicitBackPath || "/food/user"
  }

  if (/^\/user\/dining\/book(\/|$)/.test(normalizedPath)) {
    return explicitBackPath || "/food/user/dining"
  }

  if (/^\/user\/dining\/[^/]+\/[^/]+$/.test(normalizedPath)) {
    return explicitBackPath || "/food/user/dining"
  }

  if (
    normalizedPath === "/user/dining/restaurants" ||
    normalizedPath === "/user/dining/explore/upto50" ||
    normalizedPath === "/user/dining/explore/near-rated" ||
    normalizedPath === "/user/dining/coffee"
  ) {
    return "/food/user/dining"
  }

  if (/^\/user\/dining\/[^/]+$/.test(normalizedPath)) {
    return "/food/user/dining"
  }

  if (/^\/user\/orders\/[^/]+(\/invoice|\/details)?$/.test(normalizedPath)) {
    return "/food/user/orders"
  }

  if (normalizedPath === "/user/orders") {
    return "/food/user/profile"
  }

  if (
    normalizedPath === "/user/cart/checkout" ||
    normalizedPath === "/user/cart/select-address" ||
    normalizedPath === "/user/cart/address-selector"
  ) {
    return "/food/user/cart"
  }

  if (/^\/user\/collections\/[^/]+$/.test(normalizedPath)) {
    return "/food/user/collections"
  }

  if (normalizedPath === "/user/categories") {
    return "/food/user"
  }

  if (/^\/user\/category\/[^/]+$/.test(normalizedPath)) {
    return "/food/user/categories"
  }

  if (
    normalizedPath === "/user/offers" ||
    normalizedPath === "/user/gourmet" ||
    normalizedPath === "/user/coffee"
  ) {
    return "/food/user"
  }

  if (/^\/user\/product\/[^/]+$/.test(normalizedPath)) {
    return explicitBackPath || "/food/user"
  }

  if (/^\/user\/complaints(\/|$)/.test(normalizedPath)) {
    return explicitBackPath || "/food/user/orders"
  }

  if (explicitBackPath && explicitBackPath !== pathname) {
    return explicitBackPath
  }

  return "/food/user"
}

export default function useAppBackNavigation() {
  const navigate = useNavigate()
  const location = useLocation()

  return useCallback(() => {
    const explicitBackPath = toFoodPath(location.state?.backTo) || toFoodPath(location.state?.from)
    if (explicitBackPath && explicitBackPath !== location.pathname) {
      navigate(explicitBackPath)
      return
    }

    // React Router tracks history index in window.history.state.idx
    // If idx > 1, going back (-1) stays inside the user food app (idx - 1 >= 1).
    // If idx <= 1, going back (-1) would pop back to idx = 0 (which is the root "/" Launch Landing Page).
    // In that case, navigate explicitly to resolveBackPath(location) (e.g. "/food/user") instead of escaping to the landing page.
    if (window.history.state && typeof window.history.state.idx === "number" && window.history.state.idx > 1) {
      navigate(-1)
    } else {
      navigate(resolveBackPath(location))
    }
  }, [location, navigate])
}

