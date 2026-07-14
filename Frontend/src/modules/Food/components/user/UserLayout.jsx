import { Outlet, useLocation, useNavigate } from "react-router-dom"
import { useEffect, useState, createContext, useContext, useRef, useCallback } from "react"
import { ProfileProvider } from "@food/context/ProfileContext"
import LocationPrompt from "./LocationPrompt"
import { CartProvider } from "@food/context/CartContext"
import { OrdersProvider } from "@food/context/OrdersContext"
import { WifiOff, RefreshCw } from "lucide-react"
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

export default function UserLayout() {
  const location = useLocation()
  const [isOffline, setIsOffline] = useState(!navigator.onLine)
  const [hasConnectionError, setHasConnectionError] = useState(false)

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
    normalizedPath === "/under-250" ||
    normalizedPath === "/user/under-250" ||
    isProfileRoot ||
    normalizedPath === "" // Handle empty string case for root relative to /food

  const isUnder250 = normalizedPath === "/under-250" || normalizedPath === "/user/under-250"

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

  return (
    <div className="min-h-screen bg-[#f5f5f5] dark:bg-[#0a0a0a] transition-colors duration-200">
      <CartProvider>
        <ProfileProvider>
          <OrdersProvider>
            <SearchOverlayProvider>
              <LocationSelectorProvider>
                {/* <Navbar /> */}
                {/* Desktop Navbar - Hidden on mobile, visible on medium+ screens */}
                <div className="hidden md:block">
                  {showBottomNav && <DesktopNavbar showLogo={!isUnder250} />}
                </div>
                {/* <LocationPrompt /> */}
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
  )
}
