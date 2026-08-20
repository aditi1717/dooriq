import { Outlet, useLocation, useNavigate } from "react-router-dom"
import { useEffect, useState, createContext, useContext, useRef, useCallback } from "react"
import { ProfileProvider, useProfile } from "@food/context/ProfileContext"
import LocationPrompt from "./LocationPrompt"
import { CartProvider, useCart } from "@food/context/CartContext"
import { OrdersProvider } from "@food/context/OrdersContext"
import { WifiOff, RefreshCw, Clock, Lock, Sparkles, PartyPopper, ArrowRight } from "lucide-react"
import confetti from "canvas-confetti"
import { getCachedSettings, loadBusinessSettings } from "@food/utils/businessSettings"
import { useLocation as useGeoLocation } from "@food/hooks/useLocation"
import { restaurantAPI } from "@food/api"
import { buildRadiusListingParams } from "@food/utils/publicListing"
import { toast } from "sonner"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}

import SearchOverlay from "./SearchOverlay"
import BottomNavigation from "./BottomNavigation"
import DesktopNavbar from "./DesktopNavbar"
import { useUserNotifications } from "../../hooks/useUserNotifications"

// Create SearchOverlay context with default value
const SearchOverlayContext = createContext({
  isSearchOpen: false,
  searchValue: "",
  isListening: false,
  setSearchValue: () => {
    debugWarn("SearchOverlayProvider not available")
  },
  openSearch: () => {
    debugWarn("SearchOverlayProvider not available")
  },
  closeSearch: () => { },
  startVoiceSearch: () => {
    debugWarn("SearchOverlayProvider not available")
  }
})

export function useSearchOverlay() {
  const context = useContext(SearchOverlayContext)
  // Always return context, even if provider is not available (will use default values)
  return context
}

function SearchOverlayProvider({ children }) {
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [searchValue, setSearchValue] = useState("")
  const [isListening, setIsListening] = useState(false)
  const recognitionRef = useRef(null)

  const openSearch = () => {
    setIsSearchOpen(true)
  }

  const closeSearch = () => {
    setIsSearchOpen(false)
    setSearchValue("")
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {}
    }
  }

  const startVoiceSearch = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn("Voice search is not supported in this browser.");
      return;
    }

    // Stop existing if any
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {}
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-IN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognitionRef.current = recognition;

    recognition.onstart = () => {
      setIsListening(true);
      setIsSearchOpen(true); 
    };

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setSearchValue(transcript.trim());
      setIsListening(false);
    };

    recognition.onerror = (event) => {
      console.error("Speech recognition error", event.error);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    try {
      recognition.start();
    } catch (err) {
      console.error("Failed to start recognition", err);
      setIsListening(false);
    }
  }, []);

  useEffect(() => {
    if (!isSearchOpen) return

    window.history.pushState({ searchOverlayOpen: true }, "")

    const handlePopState = () => {
      closeSearch()
    }

    window.addEventListener("popstate", handlePopState)
    return () => {
      window.removeEventListener("popstate", handlePopState)
      if (window.history.state?.searchOverlayOpen) {
        window.history.back()
      }
    }
  }, [isSearchOpen])

  return (
    <SearchOverlayContext.Provider value={{ isSearchOpen, searchValue, setSearchValue, isListening, openSearch, closeSearch, startVoiceSearch }}>
      {children}
      {isSearchOpen && (
        <SearchOverlay
          isOpen={isSearchOpen}
          onClose={closeSearch}
          searchValue={searchValue}
          onSearchChange={setSearchValue}
          isListening={isListening}
          startVoiceSearch={startVoiceSearch}
        />
      )}
    </SearchOverlayContext.Provider>
  )
}

// Create LocationSelector context with default value
const LocationSelectorContext = createContext({
  isLocationSelectorOpen: false,
  openLocationSelector: () => {
    debugWarn("LocationSelectorProvider not available")
  },
  closeLocationSelector: () => { }
})

export function useLocationSelector() {
  const context = useContext(LocationSelectorContext)
  if (!context) {
    throw new Error("useLocationSelector must be used within LocationSelectorProvider")
  }
  return context
}

function LocationSelectorProvider({ children }) {
  const navigate = useNavigate()
  const location = useLocation()

  const openLocationSelector = () => {
    // Navigate to the standalone address selector page
    // Provide current pathname to state so back button returns here accurately
    navigate("/food/user/cart/address-selector", { state: { backTo: location.pathname } })
  }

  const closeLocationSelector = () => { }

  const value = {
    isLocationSelectorOpen: false,
    openLocationSelector,
    closeLocationSelector
  }

  return (
    <LocationSelectorContext.Provider value={value}>
      {children}
    </LocationSelectorContext.Provider>
  )
}

function CartRadiusGuard() {
  const { cart, clearCart } = useCart()
  const { getDefaultAddress } = useProfile()
  const { location: liveLocation } = useGeoLocation()
  const [deliveryAddressMode, setDeliveryAddressMode] = useState(() => {
    if (typeof window === "undefined") return "saved"
    return window.localStorage.getItem("deliveryAddressMode") || "saved"
  })
  const lastCheckedKeyRef = useRef("")

  useEffect(() => {
    const readMode = () => {
      if (typeof window === "undefined") return
      const nextMode = window.localStorage.getItem("deliveryAddressMode") || "saved"
      setDeliveryAddressMode(nextMode)
    }

    window.addEventListener("focus", readMode)
    window.addEventListener("storage", readMode)
    window.addEventListener("deliveryAddressModeChanged", readMode)
    return () => {
      window.removeEventListener("focus", readMode)
      window.removeEventListener("storage", readMode)
      window.removeEventListener("deliveryAddressModeChanged", readMode)
    }
  }, [])

  useEffect(() => {
    const cartItems = Array.isArray(cart) ? cart : []
    if (cartItems.length === 0) return

    const defaultAddress = getDefaultAddress?.() || null
    const coords = defaultAddress?.location?.coordinates
    const savedLocation = Array.isArray(coords) && coords.length >= 2
      ? { latitude: Number(coords[1]), longitude: Number(coords[0]) }
      : {
        latitude: Number(defaultAddress?.latitude ?? defaultAddress?.lat),
        longitude: Number(defaultAddress?.longitude ?? defaultAddress?.lng),
      }

    const useSavedAddress =
      deliveryAddressMode === "saved" &&
      Number.isFinite(savedLocation.latitude) &&
      Number.isFinite(savedLocation.longitude)
    const effectiveLocation = useSavedAddress ? savedLocation : liveLocation
    const params = buildRadiusListingParams(effectiveLocation, { limit: 50 })
    if (!params) return

    const cartRestaurantId = String(cartItems[0]?.restaurantId || "").trim()
    const cartRestaurantName = String(cartItems[0]?.restaurant || "").trim().toLowerCase()
    if (!cartRestaurantId && !cartRestaurantName) return

    const checkKey = JSON.stringify({
      lat: Number(params.lat).toFixed(6),
      lng: Number(params.lng).toFixed(6),
      restaurantId: cartRestaurantId,
      restaurantName: cartRestaurantName,
    })
    if (lastCheckedKeyRef.current === checkKey) return
    lastCheckedKeyRef.current = checkKey

    let cancelled = false
    void (async () => {
      try {
        const response = await restaurantAPI.getAllRestaurants(params, { noCache: true })
        if (cancelled) return

        const restaurants = response?.data?.data?.restaurants || response?.data?.restaurants || []
        const isRestaurantVisible = restaurants.some((restaurant) => {
          const ids = [
            restaurant?._id,
            restaurant?.id,
            restaurant?.restaurantId,
          ].filter(Boolean).map((id) => String(id))
          const names = [
            restaurant?.restaurantName,
            restaurant?.name,
          ].filter(Boolean).map((name) => String(name).trim().toLowerCase())

          return (
            (cartRestaurantId && ids.includes(cartRestaurantId)) ||
            (cartRestaurantName && names.includes(cartRestaurantName))
          )
        })

        if (!isRestaurantVisible) {
          clearCart()
          toast.info("Cart cleared because the restaurant is outside your selected delivery radius.")
        }
      } catch (error) {
        debugWarn("Cart radius validation skipped:", error)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    cart,
    clearCart,
    deliveryAddressMode,
    getDefaultAddress,
    liveLocation?.latitude,
    liveLocation?.longitude,
  ])

  return null
}

export default function UserLayout() {
  const location = useLocation()
  const [isOffline, setIsOffline] = useState(!navigator.onLine)
  const [hasConnectionError, setHasConnectionError] = useState(false)

  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('last_active_module', 'user')
        sessionStorage.setItem('entered_food_app', 'true')
      }
    } catch {}
  }, [])

  const [businessSettings, setBusinessSettings] = useState(null)
  const [timeLeft, setTimeLeft] = useState(null)
  const [dismissedLock, setDismissedLock] = useState(false)

  const isTimerEnabled = Boolean(businessSettings?.launchCountdown?.isEnabled);
  const isTimerZero = Boolean(
    isTimerEnabled &&
    timeLeft &&
    timeLeft.days === 0 &&
    timeLeft.hours === 0 &&
    timeLeft.minutes === 0 &&
    timeLeft.seconds === 0
  );

  useEffect(() => {
    if (!isTimerZero) return;
    try {
      // Trigger backend auto-disable and auto-refresh the browser page
      loadBusinessSettings().finally(() => {
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      });
    } catch (e) {
      window.location.reload();
    }
  }, [isTimerZero]);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const cached = getCachedSettings();
        if (cached) {
          setBusinessSettings(cached);
        }
        const fresh = await loadBusinessSettings();
        if (fresh) {
          setBusinessSettings(fresh);
        }
      } catch (err) {
        console.error("Failed to load settings in UserLayout", err);
      }
    };
    loadSettings();

    window.addEventListener('businessSettingsUpdated', loadSettings);
    return () => {
      window.removeEventListener('businessSettingsUpdated', loadSettings);
    }
  }, []);

  useEffect(() => {
    const rawTimerTime = businessSettings?.launchCountdown?.timerTime;
    const isEnabled = businessSettings?.launchCountdown?.isEnabled;
    const showLaunchPageOnly = businessSettings?.launchCountdown?.showLaunchPageOnly;

    if ((!isEnabled && !showLaunchPageOnly) || !rawTimerTime) {
      setTimeLeft(null);
      return;
    }

    const parseTargetDate = (timeStr) => {
      if (!timeStr) return null;
      if (typeof timeStr === 'string' && timeStr.includes('T') && !timeStr.endsWith('Z') && !timeStr.includes('+')) {
        const [datePart, timePart] = timeStr.split('T');
        const [year, month, day] = datePart.split('-').map(Number);
        const [hours, minutes] = timePart.split(':').map(Number);
        return new Date(year, month - 1, day, hours || 0, minutes || 0);
      }
      const parsed = new Date(timeStr);
      return isNaN(parsed.getTime()) ? null : parsed;
    };

    const targetDate = parseTargetDate(rawTimerTime);
    if (!targetDate) {
      setTimeLeft(null);
      return;
    }

    const calculateTimeLeft = () => {
      const difference = +targetDate - +new Date();
      if (difference <= 0) {
        return { days: 0, hours: 0, minutes: 0, seconds: 0 };
      }
      return {
        days: Math.floor(difference / (1000 * 60 * 60 * 24)),
        hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
        minutes: Math.floor((difference / 1000 / 60) % 60),
        seconds: Math.floor((difference / 1000) % 60),
      };
    };

    setTimeLeft(calculateTimeLeft());

    const interval = setInterval(() => {
      const nextTime = calculateTimeLeft();
      setTimeLeft(nextTime);
    }, 1000);

    return () => clearInterval(interval);
  }, [businessSettings]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false)
      setHasConnectionError(false)
    }
    const handleOffline = () => setIsOffline(true)
    const handleApiError = () => {
      if (navigator.onLine) {
        setHasConnectionError(true)
      }
    }

    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)
    window.addEventListener("apiNetworkError", handleApiError)

    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
      window.removeEventListener("apiNetworkError", handleApiError)
    }
  }, [])

  const handleRetry = () => {
    setHasConnectionError(false)
    setIsOffline(!navigator.onLine)
    window.location.reload()
  }

  useEffect(() => {
    // Reset scroll to top whenever location changes (pathname, search, or hash)
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [location.pathname, location.search, location.hash])

  useUserNotifications()

  // Note: Authentication checks and redirects are handled by ProtectedRoute components
  // UserLayout should not interfere with authentication redirects

  // Show bottom navigation only on home page, dining page, under-250 page, and profile page
  const path = location.pathname.startsWith("/food")
    ? location.pathname.substring(5) || "/"
    : location.pathname
  const normalizedPath =
    path.length > 1 ? path.replace(/\/+$/, "") : path

  const isProfileRoot =
    normalizedPath === "/profile" ||
    normalizedPath === "/user/profile"

  const showBottomNav = normalizedPath === "/" ||
    normalizedPath === "/user" ||
    normalizedPath === "/dining" ||
    normalizedPath === "/user/dining" ||
    normalizedPath === "/switch-99" ||
    normalizedPath === "/user/switch-99" ||
    normalizedPath === "/user/cart" ||
    normalizedPath === "/cart" ||
    isProfileRoot ||
    normalizedPath === "" // Handle empty string case for root relative to /food

  const isUnder250 = normalizedPath === "/switch-99" || normalizedPath === "/user/switch-99"

  if (isOffline || hasConnectionError) {
    return (
      <div className="min-h-screen bg-[#f8fafc] dark:bg-[#09090b] flex flex-col items-center justify-center p-4 text-center font-sans">
        <div className="relative mb-4">
          <div className="absolute inset-0 rounded-full bg-rose-500/10 dark:bg-rose-500/5 blur-xl w-20 h-20 -translate-x-2 -translate-y-2" />
          <div className="relative bg-white dark:bg-zinc-900 border border-slate-100 dark:border-zinc-800 p-5 rounded-full shadow-lg animate-bounce" style={{ animationDuration: '3s' }}>
            <WifiOff className="w-10 h-10 text-rose-500 animate-pulse" />
          </div>
        </div>
        
        <h1 className="text-xl font-extrabold text-slate-800 dark:text-white tracking-tight mb-1.5">
          {isOffline ? "No Internet Connection" : "Connection Timeout"}
        </h1>
        
        <p className="text-slate-500 dark:text-zinc-400 text-xs max-w-xs mb-6 leading-relaxed">
          {isOffline 
            ? "Your device is not connected to the internet. Please check your connection."
            : "We are having trouble connecting to our servers. Please try again."}
        </p>
        
        <button
          onClick={handleRetry}
          className="flex items-center gap-1.5 text-white px-6 py-2.5 rounded-xl text-sm font-bold shadow-md active:scale-95 transition-all duration-200"
          style={{
            backgroundColor: "var(--module-theme-color, #2563EB)",
          }}
        >
          <RefreshCw className="w-4 h-4" />
          Try Again
        </button>
      </div>
    )
  }

  const isUserHomePage = normalizedPath === "/" || normalizedPath === "/user" || normalizedPath === "";
  const isAppLocked = Boolean(businessSettings?.launchCountdown?.showLaunchPageOnly) && !dismissedLock;
  const isBannerEnabled = Boolean(businessSettings?.launchCountdown?.isEnabled);
  const showCountdownClock = Boolean((isBannerEnabled || isAppLocked) && timeLeft !== null);
  const shouldShowTopPopup = (isAppLocked || isBannerEnabled) && !dismissedLock && timeLeft && isUserHomePage && !isTimerZero;

  return (
    <div className="min-h-screen bg-[#f5f5f5] dark:bg-[#0a0a0a] transition-colors duration-200">
      {/* Center Countdown Lock Modal (Middle of Screen) */}
      {isAppLocked && isUserHomePage && !isTimerZero && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-sm select-none pointer-events-auto">
          <div className="bg-white/95 dark:bg-zinc-950/90 border border-white/40 dark:border-zinc-800/80 shadow-2xl rounded-3xl p-8 sm:p-10 max-w-md w-full text-center relative overflow-hidden backdrop-blur-2xl animate-in fade-in zoom-in-95 duration-300">
            <div className="absolute -top-24 -left-24 w-48 h-48 bg-blue-500/10 rounded-full blur-[60px] pointer-events-none" />
            <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-indigo-500/15 rounded-full blur-[60px] pointer-events-none" />

            <div className="relative z-10 flex flex-col items-center">
              <div className="p-4 bg-gradient-to-tr from-blue-500/10 to-indigo-500/10 text-blue-600 dark:text-blue-400 rounded-3xl mb-6 flex-shrink-0 shadow-sm border border-blue-500/5 animate-pulse" style={{ animationDuration: '4s' }}>
                <Clock className="w-9 h-9" />
              </div>

              {businessSettings?.launchCountdown?.timerText && (
                <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white mb-3 leading-tight px-2">
                  {businessSettings.launchCountdown.timerText}
                </h2>
              )}

              {businessSettings?.launchCountdown?.timerDescription && (
                <p className="text-sm text-slate-500 dark:text-zinc-400 leading-relaxed max-w-sm px-4 mb-6">
                  {businessSettings.launchCountdown.timerDescription}
                </p>
              )}

              {showCountdownClock && (
                <div className="flex items-center gap-3 font-mono bg-slate-50 dark:bg-zinc-900/60 px-6 py-4 rounded-2xl border border-slate-200/50 dark:border-zinc-800/40 shadow-inner w-full justify-center">
                  <div className="flex flex-col items-center min-w-[52px]">
                    <span className="text-2xl sm:text-3xl font-extrabold text-blue-600 dark:text-blue-400 leading-none">
                      {String(timeLeft.days).padStart(2, '0')}
                    </span>
                    <span className="text-[10px] text-slate-400 dark:text-zinc-500 uppercase font-sans tracking-wider mt-2 font-bold">days</span>
                  </div>
                  <span className="text-2xl text-slate-300 dark:text-zinc-700 self-start mt-0.5">:</span>
                  <div className="flex flex-col items-center min-w-[52px]">
                    <span className="text-2xl sm:text-3xl font-extrabold text-blue-600 dark:text-blue-400 leading-none">
                      {String(timeLeft.hours).padStart(2, '0')}
                    </span>
                    <span className="text-[10px] text-slate-400 dark:text-zinc-500 uppercase font-sans tracking-wider mt-2 font-bold">hours</span>
                  </div>
                  <span className="text-2xl text-slate-300 dark:text-zinc-700 self-start mt-0.5">:</span>
                  <div className="flex flex-col items-center min-w-[52px]">
                    <span className="text-2xl sm:text-3xl font-extrabold text-blue-600 dark:text-blue-400 leading-none">
                      {String(timeLeft.minutes).padStart(2, '0')}
                    </span>
                    <span className="text-[10px] text-slate-400 dark:text-zinc-500 uppercase font-sans tracking-wider mt-2 font-bold">mins</span>
                  </div>
                  <span className="text-2xl text-slate-300 dark:text-zinc-700 self-start mt-0.5">:</span>
                  <div className="flex flex-col items-center min-w-[52px]">
                    <span className="text-2xl sm:text-3xl font-extrabold text-blue-600 dark:text-blue-400 leading-none animate-pulse">
                      {String(timeLeft.seconds).padStart(2, '0')}
                    </span>
                    <span className="text-[10px] text-slate-400 dark:text-zinc-500 uppercase font-sans tracking-wider mt-2 font-bold">secs</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className={`transition-all duration-300 ${isAppLocked ? "blur-md select-none pointer-events-none" : ""}`}>
        <CartProvider>
          <ProfileProvider>
            <CartRadiusGuard />
            <OrdersProvider>
              <SearchOverlayProvider>
                <LocationSelectorProvider>
                  <div className="hidden md:block">
                    {showBottomNav && <DesktopNavbar showLogo={!isUnder250} />}
                  </div>
                  <main className={showBottomNav ? "md:pt-40" : ""}>
                    <Outlet />
                  </main>
                  {showBottomNav && <BottomNavigation />}
                </LocationSelectorProvider>
              </SearchOverlayProvider>
            </OrdersProvider>
          </ProfileProvider>
        </CartProvider>
      </div>
    </div>
  )
}
