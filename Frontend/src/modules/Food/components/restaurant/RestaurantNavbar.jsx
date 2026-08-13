import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { Search, ChevronRight, MapPin, X, Bell } from "lucide-react"
import { restaurantAPI } from "@food/api"
import { getCachedSettings, getModuleLogoUrl, loadBusinessSettings } from "@food/utils/businessSettings"
import { getRestaurantAvailabilityStatus } from "@food/utils/restaurantAvailability"
import useNotificationInbox from "@food/hooks/useNotificationInbox"

const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}

const extractRestaurantPayload = (response) =>
  response?.data?.data?.restaurant ||
  response?.data?.restaurant ||
  response?.data?.data?.user ||
  response?.data?.user ||
  response?.data?.data ||
  null


export default function RestaurantNavbar({
  restaurantName: propRestaurantName,
  location: propLocation,
  showSearch = true,
  showOfflineOnlineTag = true,
  showNotifications = true,
}) {
  const navigate = useNavigate()
  const [isSearchActive, setIsSearchActive] = useState(false)
  const [searchValue, setSearchValue] = useState("")
  const [status, setStatus] = useState("Offline")
  const [restaurantData, setRestaurantData] = useState(null)
  const [outletTimings, setOutletTimings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [companyName, setCompanyName] = useState("")
  const [logoUrl, setLogoUrl] = useState(null)
  const { unreadCount } = useNotificationInbox("restaurant", { limit: 20, pollMs: 5 * 60 * 1000 })

  // Load business settings for branding
  useEffect(() => {
    const loadSettings = async () => {
      const cached = getCachedSettings()
      if (cached) {
        if (cached.companyName) setCompanyName(cached.companyName)
        const resolvedLogo = getModuleLogoUrl("restaurant")
        if (resolvedLogo) setLogoUrl(resolvedLogo)
      } else {
        const settings = await loadBusinessSettings()
        if (settings) {
          if (settings.companyName) setCompanyName(settings.companyName)
          const resolvedLogo = getModuleLogoUrl("restaurant")
          if (resolvedLogo) setLogoUrl(resolvedLogo)
        }
      }
    }
    loadSettings()

    const handleSettingsUpdate = () => {
      const cached = getCachedSettings()
      if (cached) {
        if (cached.companyName) setCompanyName(cached.companyName)
        const resolvedLogo = getModuleLogoUrl("restaurant")
        if (resolvedLogo) setLogoUrl(resolvedLogo)
      }
    }
    window.addEventListener('businessSettingsUpdated', handleSettingsUpdate)
    return () => window.removeEventListener('businessSettingsUpdated', handleSettingsUpdate)
  }, [])

  // Fetch restaurant data and outlet timings on mount
  useEffect(() => {
    const fetchRestaurantData = async () => {
      try {
        setLoading(true)
        const [profileRes, timingsRes] = await Promise.allSettled([
          restaurantAPI.getCurrentRestaurant(),
          restaurantAPI.getOutletTimings()
        ])
        if (profileRes.status === "fulfilled") {
          const data = extractRestaurantPayload(profileRes.value)
          if (data) setRestaurantData(data)
        }
        if (timingsRes.status === "fulfilled") {
          const data = timingsRes.value?.data?.data?.outletTimings || timingsRes.value?.data?.outletTimings
          if (data) setOutletTimings(data)
        }
      } catch (error) {
        if (error.code !== 'ERR_NETWORK' && error.code !== 'ECONNABORTED' && !error.message?.includes('timeout')) {
          debugError("Error fetching restaurant data:", error)
        }
      } finally {
        setLoading(false)
      }
    }

    fetchRestaurantData()
  }, [])

  // Format full address from location object - using stored data only, no live fetching
  const formatAddress = (location) => {
    if (!location) return ""
    
    // Priority 1: Use formattedAddress if available (stored address from database)
    if (location.formattedAddress && location.formattedAddress.trim() !== "" && location.formattedAddress !== "Select location") {
      // Check if it's just coordinates (latitude, longitude format)
      const isCoordinates = /^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(location.formattedAddress.trim())
      if (!isCoordinates) {
        return location.formattedAddress.trim()
      }
    }
    
    // Priority 2: Use address field if available
    if (location.address && location.address.trim() !== "") {
      return location.address.trim()
    }
    
    // Priority 3: Build from individual components
    const parts = []
    
    // Add street address (addressLine1 or street)
    if (location.addressLine1) {
      parts.push(location.addressLine1.trim())
    } else if (location.street) {
      parts.push(location.street.trim())
    }
    
    // Add addressLine2 if available
    if (location.addressLine2) {
      parts.push(location.addressLine2.trim())
    }
    
    // Add area if available
    if (location.area) {
      parts.push(location.area.trim())
    }
    
    // Add landmark if available
    if (location.landmark) {
      parts.push(location.landmark.trim())
    }
    
    // Add city if available and not already in area
    if (location.city) {
      const city = location.city.trim()
      // Only add city if it's not already included in previous parts
      const cityAlreadyIncluded = parts.some(part => part.toLowerCase().includes(city.toLowerCase()))
      if (!cityAlreadyIncluded) {
        parts.push(city)
      }
    }
    
    // Add state if available
    if (location.state) {
      const state = location.state.trim()
      // Only add state if it's not already included
      const stateAlreadyIncluded = parts.some(part => part.toLowerCase().includes(state.toLowerCase()))
      if (!stateAlreadyIncluded) {
        parts.push(state)
      }
    }
    
    // Add zipCode/pincode if available
    if (location.zipCode || location.pincode || location.postalCode) {
      const zip = (location.zipCode || location.pincode || location.postalCode).trim()
      parts.push(zip)
    }
    
    return parts.length > 0 ? parts.join(", ") : ""
  }

  // Get restaurant name (use prop if provided, otherwise use fetched data)
  const restaurantName = propRestaurantName || restaurantData?.name || "Restaurant"

  const [location, setLocation] = useState("")

  // Update location when restaurantData or propLocation changes
  useEffect(() => {
    let newLocation = ""
    
    // Priority 1: Explicit prop takes highest priority
    if (propLocation && propLocation.trim() !== "") {
      newLocation = propLocation.trim()
    }
    // Priority 2: Check restaurantData location
    else if (restaurantData) {
      debugLog('?? Checking restaurant data for address:', {
        hasLocation: !!restaurantData.location,
        locationKeys: restaurantData.location ? Object.keys(restaurantData.location) : [],
        formattedAddress: restaurantData.location?.formattedAddress,
        address: restaurantData.location?.address,
        directAddress: restaurantData.address,
        fullLocation: restaurantData.location
      })
      
      if (restaurantData.location) {
        // Use stored formattedAddress first (from database)
        if (restaurantData.location.formattedAddress && 
            restaurantData.location.formattedAddress.trim() !== "" && 
            restaurantData.location.formattedAddress !== "Select location") {
          // Check if it's just coordinates (latitude, longitude format)
          const isCoordinates = /^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(restaurantData.location.formattedAddress.trim())
          if (!isCoordinates) {
            newLocation = restaurantData.location.formattedAddress.trim()
            debugLog('? Using formattedAddress:', newLocation)
          }
        }
        
        // If formattedAddress is not available or is coordinates, try formatAddress function
        if (!newLocation) {
          const formatted = formatAddress(restaurantData.location)
          if (formatted && formatted.trim() !== "") {
            newLocation = formatted.trim()
            debugLog('? Using formatAddress result:', newLocation)
          }
        }
        
        // Additional fallback: check if address is directly on location
        if (!newLocation && restaurantData.location.address && restaurantData.location.address.trim() !== "") {
          newLocation = restaurantData.location.address.trim()
          debugLog('? Using location.address:', newLocation)
        }
      }
      
      // Priority 3: Fallback - check if address is directly on restaurantData (not in location object)
      if (!newLocation && restaurantData.address && restaurantData.address.trim() !== "") {
        newLocation = restaurantData.address.trim()
        debugLog('? Using restaurantData.address:', newLocation)
      }
    }
    
    setLocation(newLocation)
    
    // Debug log
    if (newLocation) {
      debugLog('?? Restaurant address displayed:', newLocation)
    } else if (restaurantData) {
      debugLog('?? Restaurant data available but no address found')
    }
  }, [restaurantData, propLocation])

  const [updatingStatus, setUpdatingStatus] = useState(false)

  // Load status considering both manual toggle and outlet timings (operating hours)
  useEffect(() => {
    const updateStatus = () => {
      try {
        if (restaurantData) {
          const availability = getRestaurantAvailabilityStatus({
            ...restaurantData,
            outletTimings: outletTimings || restaurantData.outletTimings
          })
          const isOnline = Boolean(availability.isOpen)
          setStatus(isOnline ? "Online" : "Offline")
          localStorage.setItem('restaurant_online_status', JSON.stringify(isOnline))
          return
        }
        const savedStatus = localStorage.getItem('restaurant_online_status')
        if (savedStatus !== null) {
          const isOnline = JSON.parse(savedStatus)
          setStatus(isOnline ? "Online" : "Offline")
        }
      } catch (error) {
        debugError("Error loading restaurant status:", error)
        setStatus("Offline")
      }
    }

    updateStatus()

    // Recheck status every minute to automatically switch to Offline when closing time passes
    const interval = setInterval(updateStatus, 60000)

    const handleStatusChange = () => {
      restaurantAPI.getCurrentRestaurant().then((res) => {
        const data = extractRestaurantPayload(res)
        if (data) setRestaurantData(data)
      }).catch(() => {})
    }

    const handleTimingsUpdate = () => {
      restaurantAPI.getOutletTimings().then((res) => {
        const data = res?.data?.data?.outletTimings || res?.data?.outletTimings
        if (data) setOutletTimings(data)
      }).catch(() => {})
    }

    window.addEventListener('restaurantStatusChanged', handleStatusChange)
    window.addEventListener('outletTimingsUpdated', handleTimingsUpdate)
    
    return () => {
      clearInterval(interval)
      window.removeEventListener('restaurantStatusChanged', handleStatusChange)
      window.removeEventListener('outletTimingsUpdated', handleTimingsUpdate)
    }
  }, [restaurantData, outletTimings])

  const handleStatusClick = () => {
    navigate("/food/restaurant/status")
  }

  const handleSearchClick = () => {
    setIsSearchActive(true)
  }

  const handleSearchClose = () => {
    setIsSearchActive(false)
    setSearchValue("")
  }

  const handleSearchChange = (e) => {
    setSearchValue(e.target.value)
  }



  const handleNotificationsClick = () => {
    navigate("/restaurant/notifications")
  }

  // Show search input when search is active
  if (isSearchActive) {
    return (
      <div className="w-full bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
        {/* Search Input */}
        <div className="flex-1 relative">
          <input
            type="text"
            value={searchValue}
            onChange={handleSearchChange}
            placeholder="Search by order ID"
            className="w-full px-4 py-2 text-gray-900 placeholder-gray-500 focus:outline-none"
            autoFocus
          />
        </div>

        {/* Close Button */}
        <button
          onClick={handleSearchClose}
          className="w-6 h-6 bg-black rounded-full flex items-center justify-center shrink-0"
          aria-label="Close search"
        >
          <X className="w-3 h-3 text-white" />
        </button>
      </div>
    )
  }

  return (
    <div className="w-full bg-white/95 backdrop-blur-md border-b border-gray-100 px-4 py-3.5 flex items-center justify-between sticky top-0 z-[60]">
      {/* Left Side - Restaurant Info */}
      <div className="flex-1 min-w-0 pr-2 flex items-center gap-2.5">
        {logoUrl && (
          <img 
            src={logoUrl} 
            alt="Logo" 
            onClick={() => window.location.reload()}
            className="h-9 w-9 object-contain rounded-lg shadow-sm cursor-pointer active:scale-95 transition-transform" 
          />
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <h1 className="text-[14px] font-bold text-gray-900 truncate leading-none">
              {loading ? "Loading..." : (restaurantName || "Restaurant")}
            </h1>

          </div>
          {!loading && location && location.trim() !== "" && (
            <button
              type="button"
              onClick={() => navigate("/food/restaurant/outlet-info")}
              className="flex items-center gap-1 mt-1 opacity-70 hover:opacity-100 active:opacity-60 transition-opacity"
            >
              <MapPin className="w-2 h-2 text-gray-400 shrink-0" />
              <p className="text-[9px] text-gray-500 truncate font-medium max-w-[150px]" title={location}>
                {location}
              </p>
              <ChevronRight className="w-2.5 h-2.5 text-gray-400 shrink-0" />
            </button>
          )}
        </div>
      </div>

      {/* Right Side - Interactive Elements */}
      <div className="flex items-center gap-0.5">
        {showOfflineOnlineTag && (
          <button
            type="button"
            onClick={handleStatusClick}
            className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-xl active:scale-95 transition-all shadow-2xs cursor-pointer ${
              status === "Online" 
                ? "bg-emerald-50 border-emerald-200 hover:bg-emerald-100" 
                : "bg-rose-50 border-rose-200 hover:bg-rose-100"
            }`}
          >
            <span className={`w-2 h-2 rounded-full shrink-0 ${
              status === "Online" ? "bg-emerald-500 animate-pulse" : "bg-rose-500"
            }`}></span>
            <span className={`text-[12px] font-bold whitespace-nowrap ${
              status === "Online" ? "text-emerald-700" : "text-rose-700"
            }`}>
              {status}
            </span>
            <ChevronRight className={`w-3.5 h-3.5 shrink-0 ${
              status === "Online" ? "text-emerald-600" : "text-rose-500"
            }`} />
          </button>
        )}

        <div className="flex items-center">
          {showSearch && (
            <button
              onClick={handleSearchClick}
              className="p-1.5 hover:bg-gray-50 rounded-full transition-colors"
              aria-label="Search"
            >
              <Search className="w-5 h-5 text-gray-600" />
            </button>
          )}

          {showNotifications && (
            <button
              onClick={handleNotificationsClick}
              className="relative p-1.5 hover:bg-gray-50 rounded-full transition-colors"
              aria-label="Notifications"
            >
              <Bell className="w-5 h-5 text-gray-600" />
              {unreadCount > 0 && (
                <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-red-500 border border-white" />
              )}
            </button>
          )}


        </div>
      </div>
    </div>
  )
}
