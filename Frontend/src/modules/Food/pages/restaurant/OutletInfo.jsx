import { useState, useEffect, useRef, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"
import Lenis from "lenis"
import {
  ArrowLeft,
  Plus,
  Star,
  ChevronRight,
  Trash2,
  X,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@food/components/ui/dialog"
import { Button } from "@food/components/ui/button"
import { Input } from "@food/components/ui/input"
import { restaurantAPI, uploadAPI, zoneAPI } from "@food/api"
import { toast } from "sonner"
import { ImageSourcePicker } from "@food/components/ImageSourcePicker"
import { isFlutterBridgeAvailable } from "@food/utils/imageUploadUtils"
import { getGoogleMapsApiKey } from "@food/utils/googleMapsApiKey"
import { loadGoogleMaps } from "@food/utils/googleMapsLoader"

const debugLog = (...args) => {}
const debugError = (...args) => {}
const OUTLET_APPROVAL_STATUS_KEY = "restaurant_outlet_update_approval_status"
const OWNER_NAME_REGEX = /^[A-Za-z]+(?:\s+[A-Za-z]+)*$/
const EMAIL_REGEX = /^(?!.*\.\.)([A-Za-z0-9]+[._%+-]?)*[A-Za-z0-9]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}$/
const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/
const GST_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
const FSSAI_REGEX = /^\d{14}$/
const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/
const ACCOUNT_NUMBER_REGEX = /^\d{9,18}$/

const hasSuspiciousEmailTld = (emailValue) => {
  const email = String(emailValue || "").trim().toLowerCase()
  const domain = email.split("@")[1] || ""
  const tld = domain.split(".").pop() || ""
  if (!tld) return true
  if (/^com+$/i.test(tld) && tld !== "com") return true
  if (/(.)\1{2,}/.test(tld)) return true
  return false
}


export default function OutletInfo() {
  const navigate = useNavigate()
  const goBack = useRestaurantBackNavigation()
  
  // State management
  const [restaurantData, setRestaurantData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [restaurantName, setRestaurantName] = useState("")
  const [cuisineTags, setCuisineTags] = useState("")
  const [address, setAddress] = useState("")
  const [mainImage, setMainImage] = useState("https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=800&h=400&fit=crop")
  const [thumbnailImage, setThumbnailImage] = useState("https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=200&h=200&fit=crop")
  const [coverImages, setCoverImages] = useState([]) // Array of cover images (separate from menu images)
  const [showEditNameDialog, setShowEditNameDialog] = useState(false)
  const [editNameValue, setEditNameValue] = useState("")
  const [showEditAddressDialog, setShowEditAddressDialog] = useState(false)
  const [addressForm, setAddressForm] = useState({
    addressLine1: "",
    addressLine2: "",
    area: "",
    city: "",
    state: "",
    pincode: "",
    landmark: "",
    latitude: "",
    longitude: "",
    zoneId: "",
  })
  const [savingAddress, setSavingAddress] = useState(false)
  const [locationSearchValue, setLocationSearchValue] = useState("")
  const [locationSuggestions, setLocationSuggestions] = useState([])
  const [isSearchingLocation, setIsSearchingLocation] = useState(false)
  const [zoneDetectionState, setZoneDetectionState] = useState({
    status: "idle",
    message: "",
    zoneName: "",
  })

  const locationSearchInputRef = useRef(null)
  const placesAutocompleteRef = useRef(null)
  const placesAutocompleteServiceRef = useRef(null)
  const placesDetailsServiceRef = useRef(null)
  const placesSessionTokenRef = useRef(null)
  const suppressSuggestionFetchRef = useRef(false)
  const mapsScriptLoadedRef = useRef(false)
  const [showEditBasicDialog, setShowEditBasicDialog] = useState(false)
  const [basicForm, setBasicForm] = useState({
    ownerName: "",
    primaryContactNumber: "",
    ownerEmail: "",
    pureVegRestaurant: false,
  })
  const [savingBasic, setSavingBasic] = useState(false)
  const [showEditBankDialog, setShowEditBankDialog] = useState(false)
  const [bankForm, setBankForm] = useState({
    accountHolderName: "",
    accountNumber: "",
    confirmAccountNumber: "",
    ifscCode: "",
    upiId: "",
    upiQrImage: "",
  })
  const [savingBank, setSavingBank] = useState(false)
  const [uploadingBankQr, setUploadingBankQr] = useState(false)
  const [showEditComplianceDialog, setShowEditComplianceDialog] = useState(false)
  const [complianceForm, setComplianceForm] = useState({
    panNumber: "",
    gstRegistered: false,
    gstNumber: "",
    gstLegalName: "",
    gstAddress: "",
    fssaiNumber: "",
    fssaiExpiry: "",
  })
  const [savingCompliance, setSavingCompliance] = useState(false)
  const [restaurantId, setRestaurantId] = useState("")
  const [restaurantMongoId, setRestaurantMongoId] = useState("")
  const [uploadingImage, setUploadingImage] = useState(false)
  const [imageType, setImageType] = useState(null) // 'profile' or 'menu'
  const [uploadingCount, setUploadingCount] = useState(0) // Track how many images are being uploaded
  const [uploadingDocType, setUploadingDocType] = useState(null)
  const [localApprovalStatus, setLocalApprovalStatus] = useState({})
  const [ratingSnapshot, setRatingSnapshot] = useState({ average: null, total: null })
  const [previewImageUrl, setPreviewImageUrl] = useState("")
  
  const profileImageInputRef = useRef(null)
  const menuImageInputRef = useRef(null)
  const panDocInputRef = useRef(null)
  const gstDocInputRef = useRef(null)
  const fssaiDocInputRef = useRef(null)
  const [activePicker, setActivePicker] = useState(null) // { type: string, ref: any, title: string, multiple: boolean, onFileSelect?: fn, description?: string, fileNamePrefix?: string }
  const bankQrInputRef = useRef(null)
  const restaurantCacheRef = useRef({ data: null, fetchedAt: 0 })
  const restaurantPromiseRef = useRef(null)

  const getCurrentRestaurantCached = useCallback(async ({ force = false, maxAgeMs = 1500 } = {}) => {
    const now = Date.now()
    if (!force && restaurantCacheRef.current.data && now - restaurantCacheRef.current.fetchedAt <= maxAgeMs) {
      return restaurantCacheRef.current.data
    }
    if (!force && restaurantPromiseRef.current) {
      return restaurantPromiseRef.current
    }

    restaurantPromiseRef.current = restaurantAPI
      .getCurrentRestaurant()
      .then((response) => {
        const data = response?.data?.data?.restaurant || response?.data?.restaurant || null
        restaurantCacheRef.current = { data, fetchedAt: Date.now() }
        return data
      })
      .finally(() => {
        restaurantPromiseRef.current = null
      })

    return restaurantPromiseRef.current
  }, [])

  const normalizeApprovalStatus = (value) => {
    const raw = String(value || "").trim().toLowerCase()
    if (raw === "pending" || raw === "approved" || raw === "rejected") return raw
    if (raw === "active") return "approved"
    return ""
  }

  const getApprovalLabel = (status) => {
    if (status === "pending") return "Pending"
    if (status === "rejected") return "Rejected"
    return "Approved"
  }

  const getApprovalBadgeClass = (status) => {
    if (status === "pending") return "bg-amber-100 text-amber-700"
    if (status === "rejected") return "bg-rose-100 text-rose-700"
    return "bg-emerald-100 text-emerald-700"
  }

  const readSectionStatusFromBackend = (section) => {
    const statusMap = restaurantData?.profileUpdateApprovalStatus || restaurantData?.updateApprovalStatus || restaurantData?.approvalStatuses || {}
    const sectionStatus = normalizeApprovalStatus(statusMap?.[section])
    if (sectionStatus) return sectionStatus

    const globalCandidates = [
      restaurantData?.profileUpdateStatus,
      restaurantData?.updateRequestStatus,
    ]
    for (const candidate of globalCandidates) {
      const normalized = normalizeApprovalStatus(candidate)
      if (normalized) return normalized
    }

    if (
      restaurantData?.pendingApproval === true ||
      restaurantData?.hasPendingProfileUpdate === true ||
      restaurantData?.hasPendingUpdateRequest === true
    ) {
      return "pending"
    }
    return ""
  }

  const hasAnyPendingFromBackend = () => {
    const statusMap = restaurantData?.profileUpdateApprovalStatus || restaurantData?.updateApprovalStatus || restaurantData?.approvalStatuses || {}
    const sectionKeys = ["name", "basic", "compliance", "bank"]
    const hasSectionPending = sectionKeys.some((key) => normalizeApprovalStatus(statusMap?.[key]) === "pending")
    if (hasSectionPending) return true

    const globalCandidates = [
      restaurantData?.profileUpdateStatus,
      restaurantData?.updateRequestStatus,
    ]
    const hasGlobalPending = globalCandidates.some((candidate) => normalizeApprovalStatus(candidate) === "pending")
    if (hasGlobalPending) return true

    return (
      restaurantData?.pendingApproval === true ||
      restaurantData?.hasPendingProfileUpdate === true ||
      restaurantData?.hasPendingUpdateRequest === true
    )
  }

  const markSectionPending = (section) => {
    const pendingEntry = { status: "pending", markedAt: Date.now() }
    setLocalApprovalStatus((prev) => ({ ...prev, [section]: pendingEntry }))
    try {
      const raw = localStorage.getItem(OUTLET_APPROVAL_STATUS_KEY)
      const parsed = raw ? JSON.parse(raw) : {}
      const rid = String(restaurantData?._id || restaurantData?.id || restaurantMongoId || restaurantId || "default")
      const current = parsed?.[rid] || {}
      parsed[rid] = { ...current, [section]: pendingEntry }
      localStorage.setItem(OUTLET_APPROVAL_STATUS_KEY, JSON.stringify(parsed))
    } catch (error) {
      debugError("Failed to persist local approval status:", error)
    }
  }

  const getLocalStatusValue = (section) => {
    const entry = localApprovalStatus?.[section]
    if (entry && typeof entry === "object") {
      return normalizeApprovalStatus(entry.status)
    }
    return normalizeApprovalStatus(entry)
  }

  const getLocalMarkedAt = (section) => {
    const entry = localApprovalStatus?.[section]
    if (entry && typeof entry === "object" && Number.isFinite(Number(entry.markedAt))) {
      return Number(entry.markedAt)
    }
    return 0
  }

  // Format address from location object
  const formatAddress = (location) => {
    if (!location) return ""
    
    const parts = []
    if (location.addressLine1) parts.push(location.addressLine1.trim())
    if (location.addressLine2) parts.push(location.addressLine2.trim())
    if (location.area) parts.push(location.area.trim())
    if (location.city) {
      const city = location.city.trim()
      // Only add city if it's not already included in area
      if (!location.area || !location.area.includes(city)) {
        parts.push(city)
      }
    }
    if (location.landmark) parts.push(location.landmark.trim())
    
    return parts.join(", ") || ""
  }

  const formatRestaurantId = (id) => {
    if (!id) return "REST000000"

    const idString = String(id)
    const parts = idString.split(/[-.]/)
    let lastDigits = ""

    if (parts.length > 0) {
      const lastPart = parts[parts.length - 1]
      const digits = lastPart.match(/\d+/g)
      if (digits && digits.length > 0) {
        const allDigits = digits.join("")
        lastDigits = allDigits.slice(-6).padStart(6, "0")
      } else {
        const allParts = parts.join("")
        const allDigits = allParts.match(/\d+/g)
        if (allDigits && allDigits.length > 0) {
          const combinedDigits = allDigits.join("")
          lastDigits = combinedDigits.slice(-6).padStart(6, "0")
        }
      }
    }

    if (!lastDigits) {
      const hash = idString.split("").reduce((acc, char) => {
        return ((acc << 5) - acc) + char.charCodeAt(0) | 0
      }, 0)
      lastDigits = Math.abs(hash).toString().slice(-6).padStart(6, "0")
    }

    return `REST${lastDigits}`
  }

  const refreshRestaurantData = useCallback(async () => {
    try {
      const response = await restaurantAPI.getCurrentRestaurant()
      const data = response?.data?.data?.restaurant || response?.data?.restaurant
      if (!data) return

      setRestaurantData(data)
      setRestaurantName(data.name || "")
      setRestaurantId(data.restaurantId || data.id || "")
      setRestaurantMongoId(String(data.id || data._id || ""))
      setAddress(formatAddress(data.location))

      if (data.cuisines && Array.isArray(data.cuisines) && data.cuisines.length > 0) {
        setCuisineTags(data.cuisines.join(", "))
      }

      if (data.profileImage?.url) {
        setThumbnailImage(data.profileImage.url)
      }

      if (data.coverImages && Array.isArray(data.coverImages) && data.coverImages.length > 0) {
        setCoverImages(data.coverImages.map((img) => ({
          url: img.url || img,
          publicId: img.publicId
        })))
        setMainImage(data.coverImages[0].url || data.coverImages[0])
      } else if (data.menuImages && Array.isArray(data.menuImages) && data.menuImages.length > 0) {
        setCoverImages(data.menuImages.map((img) => ({
          url: img.url,
          publicId: img.publicId
        })))
        setMainImage(data.menuImages[0].url)
      } else {
        setCoverImages([])
      }
    } catch (error) {
      if (error.code !== "ERR_NETWORK" && error.code !== "ECONNABORTED" && !error.message?.includes("timeout")) {
        debugError("Error fetching restaurant data:", error)
      }
    }
  }, [])

  // Fetch restaurant data on mount
  useEffect(() => {
    const fetchRestaurantData = async () => {
      try {
        setLoading(true)
        await refreshRestaurantData()
      } catch (error) {
        if (error.code !== 'ERR_NETWORK' && error.code !== 'ECONNABORTED' && !error.message?.includes('timeout')) {
          debugError("Error fetching restaurant data:", error)
        }
      } finally {
        setLoading(false)
      }
    }

    fetchRestaurantData()

    // Listen for updates from edit pages
    const handleCuisinesUpdate = () => {
      fetchRestaurantData()
    }
    const handleAddressUpdate = () => {
      fetchRestaurantData()
    }

    window.addEventListener("cuisinesUpdated", handleCuisinesUpdate)
    window.addEventListener("addressUpdated", handleAddressUpdate)
    
    return () => {
      window.removeEventListener("cuisinesUpdated", handleCuisinesUpdate)
      window.removeEventListener("addressUpdated", handleAddressUpdate)
    }
  }, [refreshRestaurantData])

  // Keep approval status in sync without requiring logout/login.
  // Poll only while there is a pending update signal.
  useEffect(() => {
    if (!restaurantData) return
    const shouldPoll = hasAnyPendingFromBackend() || ["name", "basic", "compliance", "bank"].some((section) => getLocalStatusValue(section) === "pending")
    if (!shouldPoll) return

    const intervalId = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return
      void refreshRestaurantData()
    }, 7000)

    const onFocus = () => {
      if (typeof document !== "undefined" && document.hidden) return
      void refreshRestaurantData()
    }
    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onFocus)

    return () => {
      clearInterval(intervalId)
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onFocus)
    }
  }, [restaurantData, localApprovalStatus, refreshRestaurantData])

  useEffect(() => {
    setComplianceForm({
      panNumber: String(restaurantData?.panNumber || ""),
      gstRegistered: restaurantData?.gstRegistered === true,
      gstNumber: String(restaurantData?.gstNumber || ""),
      gstLegalName: String(restaurantData?.gstLegalName || ""),
      gstAddress: String(restaurantData?.gstAddress || ""),
      fssaiNumber: String(restaurantData?.fssaiNumber || ""),
      fssaiExpiry: restaurantData?.fssaiExpiry ? new Date(restaurantData.fssaiExpiry).toISOString().slice(0, 10) : "",
    })
  }, [restaurantData])

  useEffect(() => {
    setBasicForm({
      ownerName: String(restaurantData?.ownerName || ""),
      primaryContactNumber: String(restaurantData?.primaryContactNumber || ""),
      ownerEmail: String(restaurantData?.ownerEmail || ""),
      pureVegRestaurant: restaurantData?.pureVegRestaurant === true,
    })
  }, [restaurantData])

  useEffect(() => {
    const accountNumber = String(restaurantData?.accountNumber || "")
    const upiQrImage =
      typeof restaurantData?.upiQrImage === "string"
        ? restaurantData?.upiQrImage
        : String(restaurantData?.upiQrImage?.url || "")
    setBankForm({
      accountHolderName: String(restaurantData?.accountHolderName || ""),
      accountNumber,
      confirmAccountNumber: accountNumber,
      ifscCode: String(restaurantData?.ifscCode || "").toUpperCase(),
      upiId: String(restaurantData?.upiId || ""),
      upiQrImage,
    })
  }, [restaurantData])

  useEffect(() => {
    const loc = restaurantData?.location || {}
    const addr1 = String(loc.addressLine1 || restaurantData?.addressLine1 || "")
    const addr2 = String(loc.addressLine2 || restaurantData?.addressLine2 || "")
    const area = String(loc.area || restaurantData?.area || "")
    const city = String(loc.city || restaurantData?.city || "")
    const state = String(loc.state || restaurantData?.state || "")
    const pincode = String(loc.pincode || restaurantData?.pincode || "")
    const landmark = String(loc.landmark || restaurantData?.landmark || "")
    const latitude = loc.latitude ?? restaurantData?.location?.coordinates?.[1] ?? ""
    const longitude = loc.longitude ?? restaurantData?.location?.coordinates?.[0] ?? ""
    const zoneId = restaurantData?.zoneId || ""

    setAddressForm({
      addressLine1: addr1,
      addressLine2: addr2,
      area,
      city,
      state,
      pincode,
      landmark,
      latitude,
      longitude,
      zoneId,
    })

    const fullAddr = loc.formattedAddress || loc.address || restaurantData?.address || ""
    setLocationSearchValue(fullAddr)
  }, [restaurantData])

  const fetchPincodeFromLatLng = async (lat, lng) => {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`,
        { headers: { "Accept-Language": "en" } }
      )
      const data = await res.json()
      return data?.address?.postcode || ""
    } catch {
      return ""
    }
  }

  const detectAndSetZoneForLocation = async (lat, lng) => {
    const latitude = Number(lat)
    const longitude = Number(lng)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      setZoneDetectionState({
        status: "failed",
        message: "Unable to detect zone because location coordinates are missing.",
        zoneName: "",
      })
      return
    }

    try {
      setZoneDetectionState({
        status: "detecting",
        message: "Detecting service zone for this location...",
        zoneName: "",
      })
      const res = await zoneAPI.detectZone(latitude, longitude)
      const payload = res?.data?.data
      const isInService = payload?.status === "IN_SERVICE" && !!payload?.zoneId
      const detectedZoneId = String(payload?.zoneId || "")
      const detectedZone = payload?.zone
      const detectedZoneName =
        detectedZone?.name || detectedZone?.zoneName || detectedZone?.serviceLocation || ""

      if (isInService) {
        setZoneDetectionState({
          status: "matched",
          message: detectedZoneName
            ? `Zone auto-detected: ${detectedZoneName}`
            : "Zone auto-detected for this location.",
          zoneName: detectedZoneName,
        })
        setAddressForm((prev) => ({
          ...prev,
          latitude,
          longitude,
          zoneId: detectedZoneId,
        }))
        return
      }

      setAddressForm({
        addressLine1: "",
        addressLine2: "",
        area: "",
        city: "",
        state: "",
        pincode: "",
        landmark: "",
        latitude: "",
        longitude: "",
        zoneId: "",
      })
      setLocationSearchValue("")
      setLocationSuggestions([])
      setZoneDetectionState({
        status: "out_of_zone",
        message: "No active zone found at this location. All fields cleared.",
        zoneName: "",
      })
      toast.error("This location is outside our service zones. Address fields have been cleared.")
    } catch (err) {
      debugError("Failed to detect zone for location:", err)
      setZoneDetectionState({
        status: "failed",
        message: "Could not verify zone right now. Please reselect the location.",
        zoneName: "",
      })
    }
  }

  useEffect(() => {
    if (!showEditAddressDialog) return

    let cancelled = false
    let autocomplete = null

    const init = async () => {
      let inputElement = null
      for (let i = 0; i < 50; i++) {
        if (locationSearchInputRef.current) {
          inputElement = locationSearchInputRef.current
          break
        }
        await new Promise((r) => setTimeout(r, 100))
      }

      if (!inputElement || cancelled) return

      const loadMaps = async () => {
        // Delegates to the single shared loader. The previous inline version
        // could REMOVE another component's script tag when its `libraries`
        // string differed, breaking whichever map had loaded first.
        const google = await loadGoogleMaps()
        const ok = Boolean(google?.maps?.places?.Autocomplete)
        mapsScriptLoadedRef.current = ok
        return ok
      }

      const parsePlace = (place) => {
        const formattedAddress = place?.formatted_address || ""
        const comps = Array.isArray(place?.address_components) ? place.address_components : []
        const get = (types) => comps.find((c) => types.some((t) => c.types?.includes(t)))?.long_name || ""

        const area = get(["sublocality_level_1", "sublocality", "neighborhood"]) || get(["locality"])
        const city = get(["locality"]) || get(["administrative_area_level_2"])
        const state = get(["administrative_area_level_1"]) || get(["administrative_area_level_2"])
        const pincode = get(["postal_code"])
        const lat = place?.geometry?.location?.lat?.()
        const lng = place?.geometry?.location?.lng?.()

        return {
          formattedAddress,
          area,
          city,
          state,
          pincode,
          latitude: typeof lat === "number" ? Number(lat.toFixed(6)) : "",
          longitude: typeof lng === "number" ? Number(lng.toFixed(6)) : "",
        }
      }

      const ok = await loadMaps()
      if (!ok || cancelled || !inputElement) return

      if (inputElement.hasAttribute("data-google-places-initialized")) return

      try {
        if (!placesAutocompleteServiceRef.current && window.google?.maps?.places?.AutocompleteService) {
          placesAutocompleteServiceRef.current = new window.google.maps.places.AutocompleteService()
        }
        if (!placesDetailsServiceRef.current && window.google?.maps?.places?.PlacesService) {
          const detailsHost = document.createElement("div")
          placesDetailsServiceRef.current = new window.google.maps.places.PlacesService(detailsHost)
        }
        if (!placesSessionTokenRef.current && window.google?.maps?.places?.AutocompleteSessionToken) {
          placesSessionTokenRef.current = new window.google.maps.places.AutocompleteSessionToken()
        }

        autocomplete = new window.google.maps.places.Autocomplete(inputElement, {
          fields: ["formatted_address", "address_components", "geometry"],
          componentRestrictions: { country: "in" }
        })

        inputElement.setAttribute("data-google-places-initialized", "true")
        placesAutocompleteRef.current = autocomplete

        autocomplete.addListener("place_changed", async () => {
          const place = autocomplete.getPlace()
          if (!place?.geometry) return

          const parsed = parsePlace(place)
          const resolvedPincode = parsed.pincode || (
            parsed.latitude !== "" && parsed.longitude !== ""
              ? await fetchPincodeFromLatLng(parsed.latitude, parsed.longitude)
              : ""
          )
          setAddressForm((prev) => ({
            ...prev,
            area: parsed.area || prev.area,
            city: parsed.city || prev.city,
            state: parsed.state || prev.state,
            pincode: resolvedPincode || prev.pincode,
            latitude: parsed.latitude !== "" ? parsed.latitude : prev.latitude,
            longitude: parsed.longitude !== "" ? parsed.longitude : prev.longitude,
          }))
          
          setLocationSearchValue(parsed.formattedAddress)
          inputElement.blur()
          void detectAndSetZoneForLocation(parsed.latitude, parsed.longitude)
        })

        const pacContainerFix = () => {
          const applyFix = () => {
            const containers = document.querySelectorAll(".pac-container")
            if (containers.length > 0) {
              containers.forEach((container) => {
                container.style.zIndex = "999999"
                container.style.pointerEvents = "auto"
                container.style.visibility = "visible"
                container.style.display = "block"
              })
            }
          }
          applyFix()
          setTimeout(applyFix, 100)
          setTimeout(applyFix, 300)
        }

        inputElement.addEventListener("focus", pacContainerFix)
        inputElement.addEventListener("input", pacContainerFix)
      } catch (e) {
        debugError("Autocomplete error:", e)
      }
    }

    init().catch(() => {})

    return () => {
      cancelled = true
      if (autocomplete) {
        try { window.google?.maps?.event?.clearInstanceListeners(autocomplete) } catch {}
      }
      if (locationSearchInputRef.current) {
        locationSearchInputRef.current.removeAttribute("data-google-places-initialized")
      }
      placesAutocompleteRef.current = null
    }
  }, [showEditAddressDialog])

  useEffect(() => {
    if (!showEditAddressDialog) return
    if (suppressSuggestionFetchRef.current) {
      suppressSuggestionFetchRef.current = false
      return
    }
    const q = locationSearchValue ? locationSearchValue.replace(/\s+/g, " ").trim() : ""
    if (q.length < 3) {
      setLocationSuggestions([])
      setIsSearchingLocation(false)
      if (window.google?.maps?.places?.AutocompleteSessionToken) {
        placesSessionTokenRef.current = new window.google.maps.places.AutocompleteSessionToken()
      }
      return
    }

    const t = setTimeout(async () => {
      try {
        setIsSearchingLocation(true)
        const hasGoogleAutocompleteService =
          !!placesAutocompleteServiceRef.current && !!window.google?.maps?.places?.PlacesServiceStatus

        if (hasGoogleAutocompleteService) {
          if (!placesSessionTokenRef.current && window.google?.maps?.places?.AutocompleteSessionToken) {
            placesSessionTokenRef.current = new window.google.maps.places.AutocompleteSessionToken()
          }

          const predictions = await new Promise((resolve) => {
            placesAutocompleteServiceRef.current.getPlacePredictions(
              {
                input: q,
                componentRestrictions: { country: "in" },
                sessionToken: placesSessionTokenRef.current || undefined,
              },
              (items, status) => {
                const ok = status === window.google.maps.places.PlacesServiceStatus.OK
                resolve(ok && Array.isArray(items) ? items : [])
              }
            )
          })

          if (predictions.length > 0) {
            const mappedGoogle = predictions.slice(0, 6).map((p) => ({
              id: p.place_id,
              placeId: p.place_id,
              display: p.description || "",
              mainText: p.structured_formatting?.main_text || "",
              secondaryText: p.structured_formatting?.secondary_text || "",
              source: "google",
            }))
            setLocationSuggestions(mappedGoogle)
            return
          }
        }

        const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=6&q=${encodeURIComponent(q)}&countrycodes=in`
        const res = await fetch(url, { headers: { Accept: "application/json" } })
        const json = await res.json()
        if (Array.isArray(json)) {
          const mappedNominatim = json.map((item) => ({
            id: String(item.place_id),
            display: item.display_name,
            lat: parseFloat(item.lat),
            lng: parseFloat(item.lon),
            addr: item.address || {},
            source: "nominatim",
          }))
          setLocationSuggestions(mappedNominatim)
        }
      } catch (err) {
        debugError("Suggestion search error:", err)
      } finally {
        setIsSearchingLocation(false)
      }
    }, 500)

    return () => clearTimeout(t)
  }, [locationSearchValue, showEditAddressDialog])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(OUTLET_APPROVAL_STATUS_KEY)
      const parsed = raw ? JSON.parse(raw) : {}
      const rid = String(restaurantData?._id || restaurantData?.id || restaurantMongoId || restaurantId || "default")
      setLocalApprovalStatus(parsed?.[rid] || {})
    } catch (error) {
      debugError("Failed to read local approval status:", error)
    }
  }, [restaurantData?._id, restaurantData?.id, restaurantMongoId, restaurantId])

  useEffect(() => {
    if (!restaurantData) return
    const sections = ["name", "basic", "compliance", "bank", "address"]
    const next = { ...localApprovalStatus }
    const backendUpdatedAt = Number(new Date(restaurantData?.updatedAt || 0))
    let changed = false
    sections.forEach((section) => {
      const backendStatus = readSectionStatusFromBackend(section)
      const localStatus = getLocalStatusValue(section)
      if ((backendStatus === "approved" || backendStatus === "rejected") && localStatus && localStatus !== backendStatus) {
        next[section] = { status: backendStatus, markedAt: Date.now() }
        changed = true
      }

      // Fallback: if backend has no pending signal anymore and data was updated after local edit,
      // resolve stale local pending to approved.
      if (!backendStatus && localStatus === "pending" && !hasAnyPendingFromBackend()) {
        const markedAt = getLocalMarkedAt(section)
        if (backendUpdatedAt && markedAt && backendUpdatedAt > markedAt) {
          next[section] = { status: "approved", markedAt: Date.now() }
          changed = true
        }
      }
    })
    if (!changed) return
    setLocalApprovalStatus(next)
    try {
      const raw = localStorage.getItem(OUTLET_APPROVAL_STATUS_KEY)
      const parsed = raw ? JSON.parse(raw) : {}
      const rid = String(restaurantData?._id || restaurantData?.id || restaurantMongoId || restaurantId || "default")
      parsed[rid] = next
      localStorage.setItem(OUTLET_APPROVAL_STATUS_KEY, JSON.stringify(parsed))
    } catch (error) {
      debugError("Failed to sync local approval status:", error)
    }
  }, [restaurantData])

  const getSectionStatus = (section) => {
    const backendStatus = readSectionStatusFromBackend(section)
    if (backendStatus) return backendStatus
    const local = getLocalStatusValue(section)
    return local || "approved"
  }

  // Lenis smooth scrolling
  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.2,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
    })

    function raf(time) {
      lenis.raf(time)
      requestAnimationFrame(raf)
    }

    requestAnimationFrame(raf)

    return () => {
      lenis.destroy()
    }
  }, [])

  // Handle profile image replacement
  const handleProfileImageReplace = async (file) => {
    if (!file) return

    try {
      setUploadingImage(true)
      setImageType('profile')

      // Upload image to Cloudinary
      const uploadResponse = await restaurantAPI.uploadProfileImage(file)
      const uploadedImage = uploadResponse?.data?.data?.profileImage

      if (uploadedImage) {
        if (uploadedImage.url) {
          setThumbnailImage(uploadedImage.url)
        }
        
        // Refresh restaurant data
        const data = await getCurrentRestaurantCached({ force: true })
        if (data) {
          setRestaurantData(data)
          if (data.profileImage?.url) {
            setThumbnailImage(data.profileImage.url)
          }
        }
      }
    } catch (error) {
      debugError("Error uploading profile image:", error)
      toast.error("Failed to upload image. Please try again.")
    } finally {
      setUploadingImage(false)
      setImageType(null)
    }
  }

  // Handle multiple cover images addition
  const handleCoverImageAdd = async (files) => {
    if (!files || (Array.isArray(files) && files.length === 0)) return
    const fileArray = Array.isArray(files) ? files : [files]

    try {
      setUploadingImage(true)
      setImageType('menu')
      setUploadingCount(fileArray.length)

      // Get current images
      const currentData = await getCurrentRestaurantCached()
      const existingImages = currentData?.menuImages && Array.isArray(currentData.menuImages)
        ? currentData.menuImages.map(img => ({
            url: img.url,
            publicId: img.publicId
          }))
        : []

      const uploadedImageData = []
      const failedUploads = []
      
      for (let i = 0; i < fileArray.length; i++) {
        try {
          const uploadResponse = await restaurantAPI.uploadMenuImage(fileArray[i])
          const uploadedImage = uploadResponse?.data?.data?.menuImage
          if (uploadedImage?.url) {
            uploadedImageData.push({
              url: uploadedImage.url,
              publicId: uploadedImage.publicId || null
            })
          }
        } catch (error) {
          failedUploads.push({ fileName: fileArray[i]?.name || "image", error: error.message })
        }
      }

      if (uploadedImageData.length > 0) {
        const allImages = [...existingImages]
        uploadedImageData.forEach(uploaded => {
          if (!allImages.find(img => img.url === uploaded.url)) {
            allImages.push(uploaded)
          }
        })

        try {
          await restaurantAPI.updateProfile({ menuImages: allImages })
          toast.success(`Successfully uploaded ${uploadedImageData.length} image(s)`)
        } catch (updateError) {
          toast.error("Images uploaded but failed to save.")
        }

        setCoverImages(allImages)
        if (allImages.length > 0) setMainImage(allImages[0].url)
      }
    } catch (error) {
      toast.error("Failed to upload images.")
    } finally {
      setUploadingImage(false)
      setImageType(null)
      setUploadingCount(0)
    }
  }

  const handleImageClick = (type, ref, title, multiple = false) => {
    if (isFlutterBridgeAvailable()) {
      setActivePicker({ type, ref, title, multiple })
    } else {
      ref.current?.click()
    }
  }

  const handleDocImageClick = (docType, ref, title) => {
    if (isFlutterBridgeAvailable()) {
      setActivePicker({
        type: `${docType}-doc`,
        ref,
        title,
        multiple: false,
        onFileSelect: (file) => handleComplianceDocUpload(docType, file),
        description: `Choose how to upload your ${docType.toUpperCase()} document`,
        fileNamePrefix: `outlet-${docType}-doc`,
      })
    } else {
      ref.current?.click()
    }
  }

  const handleComplianceDocUpload = async (type, file) => {
    if (!file) return
    try {
      if (file.size > 5 * 1024 * 1024) {
        toast.error("Image size too large. Max 5MB allowed.")
        return
      }
      setUploadingDocType(type)
      const uploadRes = await uploadAPI.uploadMedia(file, { folder: `food/restaurants/compliance/${type}` })
      const url = uploadRes?.data?.data?.url || uploadRes?.data?.url || ""
      if (!url) throw new Error("Upload failed")
      const fieldMap = { pan: "panImage", gst: "gstImage", fssai: "fssaiImage" }
      const field = fieldMap[type]
      await restaurantAPI.updateProfile({ [field]: url })
      setRestaurantData((prev) => (prev ? { ...prev, [field]: url } : prev))
      markSectionPending("compliance")
      toast.success("Document uploaded successfully")
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to upload document")
    } finally {
      setUploadingDocType(null)
    }
  }

  // Handle cover image deletion
  const handleCoverImageDelete = async (indexToDelete) => {
    if (!window.confirm("Are you sure you want to delete this cover image?")) return

    try {
      setUploadingImage(true)
      setImageType('menu')

      const updatedImages = coverImages.filter((_, index) => index !== indexToDelete)
      const menuImagesForBackend = updatedImages.map(img => ({
        url: img.url,
        publicId: img.publicId || null
      }))

      await restaurantAPI.updateProfile({ menuImages: menuImagesForBackend })
      setCoverImages(updatedImages)
      if (indexToDelete === 0 && updatedImages.length > 0) {
        setMainImage(updatedImages[0].url)
      } else if (updatedImages.length === 0) {
        setMainImage("https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=800&h=400&fit=crop")
      }
      toast.success("Image deleted successfully")
    } catch (error) {
      toast.error("Failed to delete image.")
    } finally {
      setUploadingImage(false)
      setImageType(null)
    }
  }

  const handleProfileImageDelete = async () => {
    if (!window.confirm("Are you sure you want to delete outlet image?")) return
    try {
      setUploadingImage(true)
      setImageType('profile')
      await restaurantAPI.updateProfile({ profileImage: "" })
      setThumbnailImage("https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=200&h=200&fit=crop")
      const data = await getCurrentRestaurantCached({ force: true })
      if (data) {
        setRestaurantData(data)
        if (data.profileImage?.url) {
          setThumbnailImage(data.profileImage.url)
        }
      }
      toast.success("Outlet image deleted successfully")
    } catch (error) {
      toast.error("Failed to delete outlet image.")
    } finally {
      setUploadingImage(false)
      setImageType(null)
    }
  }

  // Handle edit name dialog
  const handleOpenEditDialog = () => {
    setEditNameValue(restaurantName)
    setShowEditNameDialog(true)
  }

  const handleSaveCompliance = async () => {
    const panNumber = String(complianceForm.panNumber || "").trim().toUpperCase()
    const gstNumber = String(complianceForm.gstNumber || "").trim().toUpperCase()
    const gstLegalName = String(complianceForm.gstLegalName || "").trim()
    const gstAddress = String(complianceForm.gstAddress || "").trim()
    const fssaiNumber = String(complianceForm.fssaiNumber || "").trim()

    if (panNumber && !PAN_REGEX.test(panNumber)) {
      toast.error("Invalid PAN format (e.g. ABCDE1234F)")
      return
    }
    if (complianceForm.gstRegistered && !gstNumber) {
      toast.error("GST number is required when GST is registered")
      return
    }
    if (gstNumber && !GST_REGEX.test(gstNumber)) {
      toast.error("Invalid GST format (e.g. 27ABCDE1234F1Z5)")
      return
    }
    if (complianceForm.gstRegistered && !gstLegalName) {
      toast.error("GST legal name is required")
      return
    }
    if (complianceForm.gstRegistered && !gstAddress) {
      toast.error("GST address is required")
      return
    }
    if (fssaiNumber && !FSSAI_REGEX.test(fssaiNumber)) {
      toast.error("FSSAI number must be exactly 14 digits")
      return
    }

    try {
      setSavingCompliance(true)
      const payload = {
        panNumber,
        gstRegistered: complianceForm.gstRegistered === true,
        gstNumber: complianceForm.gstRegistered ? gstNumber : "",
        gstLegalName: complianceForm.gstRegistered ? gstLegalName : "",
        gstAddress: complianceForm.gstRegistered ? gstAddress : "",
        fssaiNumber,
        fssaiExpiry: complianceForm.fssaiExpiry || null,
      }
      await restaurantAPI.updateProfile(payload)
      setRestaurantData((prev) => (prev ? { ...prev, ...payload } : prev))
      markSectionPending("compliance")
      setShowEditComplianceDialog(false)
      toast.success("Compliance details updated successfully")
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to update compliance details")
    } finally {
      setSavingCompliance(false)
    }
  }

  const handleBankQrUpload = async (file) => {
    if (!file) return
    try {
      if (file.size > 5 * 1024 * 1024) {
        toast.error("Image size too large. Max 5MB allowed.")
        return
      }
      setUploadingBankQr(true)
      const response = await uploadAPI.uploadMedia(file, { folder: "food/restaurants/upi-qr" })
      const url = response?.data?.data?.url || response?.data?.url || ""
      if (!url) throw new Error("Upload failed")
      setBankForm((prev) => ({ ...prev, upiQrImage: url }))
      toast.success("UPI QR uploaded")
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to upload UPI QR")
    } finally {
      setUploadingBankQr(false)
    }
  }

  const handleSaveBankDetails = async () => {
    const accountNumber = String(bankForm.accountNumber || "").replace(/\s|-/g, "")
    const confirmAccountNumber = String(bankForm.confirmAccountNumber || "").replace(/\s|-/g, "")
    const ifscCode = String(bankForm.ifscCode || "").trim().toUpperCase()
    const upiId = String(bankForm.upiId || "").trim()
    const accountHolderName = String(bankForm.accountHolderName || "").trim()
    if ((accountNumber || ifscCode || accountHolderName) && !ACCOUNT_NUMBER_REGEX.test(accountNumber)) {
      toast.error("Account number must be 9 to 18 digits")
      return
    }
    if (confirmAccountNumber !== accountNumber) {
      toast.error("Account numbers do not match")
      return
    }
    if ((accountNumber || ifscCode || accountHolderName) && !IFSC_REGEX.test(ifscCode)) {
      toast.error("Invalid IFSC format (e.g. SBIN0001234)")
      return
    }
    if (upiId && !/^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/.test(upiId)) {
      toast.error("Invalid UPI ID format (e.g. name@bank)")
      return
    }

    try {
      setSavingBank(true)
      const payload = {
        accountHolderName,
        accountNumber,
        ifscCode,
        upiId,
        upiQrImage: String(bankForm.upiQrImage || "").trim(),
      }
      await restaurantAPI.updateProfile(payload)
      setRestaurantData((prev) => (prev ? { ...prev, ...payload } : prev))
      markSectionPending("bank")
      setShowEditBankDialog(false)
      toast.success("Bank details updated successfully")
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to update bank details")
    } finally {
      setSavingBank(false)
    }
  }

  const handleSaveName = async () => {
    const newName = editNameValue.trim()
    if (!newName) return
    try {
      await restaurantAPI.updateProfile({ name: newName })
      setRestaurantName(newName)
      markSectionPending("name")
      setShowEditNameDialog(false)
      toast.success("Name updated successfully")
    } catch (error) {
      toast.error("Failed to update name")
    }
  }

  const handleSaveAddressDetails = async () => {
    const addressLine1 = addressForm.addressLine1.trim()
    const addressLine2 = addressForm.addressLine2.trim()
    const area = addressForm.area.trim()
    const city = addressForm.city.trim()
    const state = addressForm.state.trim()
    const pincode = addressForm.pincode.trim()
    const landmark = addressForm.landmark.trim()

    if (!addressLine1) {
      toast.error("Shop no. / building no. is required")
      return
    }
    if (!addressLine2) {
      toast.error("Floor / tower is required")
      return
    }
    if (!landmark) {
      toast.error("Nearby landmark is required")
      return
    }
    if (!area) {
      toast.error("Area is required")
      return
    }
    if (!city) {
      toast.error("City is required")
      return
    }
    if (!state) {
      toast.error("State is required")
      return
    }
    if (!pincode) {
      toast.error("Pincode is required")
      return
    }

    try {
      setSavingAddress(true)
      const existingLocation = restaurantData?.location || {}
      
      const parts = [addressLine1]
      if (addressLine2) parts.push(addressLine2)
      parts.push(area)
      parts.push(city)
      if (landmark) parts.push(landmark)
      const formattedAddress = parts.join(", ")

      const payload = {
        location: {
          ...existingLocation,
          addressLine1,
          addressLine2,
          area,
          city,
          state,
          pincode,
          landmark,
          formattedAddress,
          address: formattedAddress,
          latitude: addressForm.latitude || existingLocation.latitude,
          longitude: addressForm.longitude || existingLocation.longitude,
          coordinates: addressForm.latitude && addressForm.longitude 
            ? [addressForm.longitude, addressForm.latitude] 
            : existingLocation.coordinates,
        },
        zoneId: addressForm.zoneId || restaurantData?.zoneId,
      }
      await restaurantAPI.updateProfile(payload)
      
      setRestaurantData((prev) => {
        if (!prev) return null
        return {
          ...prev,
          addressLine1,
          addressLine2,
          area,
          city,
          state,
          pincode,
          landmark,
          zoneId: payload.zoneId,
          location: {
            ...prev.location,
            ...payload.location
          }
        }
      })
      
      markSectionPending("address")
      setShowEditAddressDialog(false)
      toast.success("Address details updated successfully")
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to update address details")
    } finally {
      setSavingAddress(false)
    }
  }

  const handleSaveBasicDetails = async () => {
    const ownerName = String(basicForm.ownerName || "").trim()
    const ownerEmail = String(basicForm.ownerEmail || "").trim().toLowerCase()
    const primaryContactNumber = String(basicForm.primaryContactNumber || "").replace(/\D/g, "")
    const currentPureVeg = restaurantData?.pureVegRestaurant === true
    const nextPureVeg = basicForm.pureVegRestaurant === true

    if (!ownerName || !OWNER_NAME_REGEX.test(ownerName)) {
      toast.error("Owner name should contain only letters and spaces")
      return
    }
    if (!ownerEmail || !EMAIL_REGEX.test(ownerEmail) || hasSuspiciousEmailTld(ownerEmail)) {
      toast.error("Please enter a valid email address")
      return
    }
    if (primaryContactNumber && !INDIAN_MOBILE_REGEX.test(primaryContactNumber)) {
      toast.error("Primary contact must be a valid 10-digit Indian mobile number")
      return
    }

    try {
      setSavingBasic(true)
      const payload = {
        ownerName,
        ownerEmail,
        pureVegRestaurant: basicForm.pureVegRestaurant === true,
      }
      await restaurantAPI.updateProfile(payload)
      setRestaurantData((prev) => (prev ? { ...prev, ...payload } : prev))
      markSectionPending("basic")
      setShowEditBasicDialog(false)
      toast.success("Basic details updated successfully")
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to update basic details")
    } finally {
      setSavingBasic(false)
    }
  }

  const direct = (value) => (value === null || value === undefined ? "" : String(value))

  const maskAccountNumber = (value) => {
    const digits = String(value || "").replace(/\D/g, "")
    if (!digits) return ""
    if (digits.length <= 4) return digits
    return `•••• •••• ${digits.slice(-4)}`
  }

  const formatDate = (dateValue) => {
    if (!dateValue) return ""
    const d = new Date(dateValue)
    if (Number.isNaN(d.getTime())) return direct(dateValue)
    return d.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    })
  }

  const isGstRegistered = restaurantData?.gstRegistered === true
  const onboardingStep3 = restaurantData?.onboarding?.step3 || {}
  const panOnboarding = onboardingStep3?.pan || {}
  const gstOnboarding = onboardingStep3?.gst || {}
  const fssaiOnboarding = onboardingStep3?.fssai || {}

  const readDocUrl = (value) => {
    if (!value) return ""
    if (typeof value === "string") return value.trim()
    if (typeof value === "object") {
      return String(value.url || value.secure_url || value.location || "").trim()
    }
    return ""
  }

  const panDocUrl =
    readDocUrl(restaurantData?.panImage) ||
    readDocUrl(panOnboarding?.image)
  const gstDocUrl =
    readDocUrl(restaurantData?.gstImage) ||
    readDocUrl(gstOnboarding?.image)
  const fssaiDocUrl =
    readDocUrl(restaurantData?.fssaiImage) ||
    readDocUrl(fssaiOnboarding?.image)

  const getViewLabel = (url) => {
    if (!url) return ""
    const cleanUrl = String(url).split("?")[0].toLowerCase()
    return cleanUrl.endsWith(".pdf") ? "View pdf" : "View image"
  }

  const openImagePreview = (url) => {
    const cleanUrl = String(url || "").trim()
    if (!cleanUrl) return
    setPreviewImageUrl(cleanUrl)
  }

  const normalizeRating = (value) => {
    if (value === null || value === undefined || value === "") return null
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed <= 0) return null
    return Math.min(5, Math.round(parsed * 10) / 10)
  }

  const extractOrderRating = (order) =>
    normalizeRating(
      order?.review?.rating ??
      order?.ratings?.restaurant?.rating ??
      order?.feedback?.rating ??
      order?.rating
    )

  const getRestaurantRatingFallback = (data) =>
    normalizeRating(
      data?.rating ??
      data?.averageRating ??
      data?.ratings?.average ??
      data?.metrics?.rating ??
      data?.stats?.averageRating ??
      data?.analytics?.averageRating
    ) || 0

  const getRestaurantReviewCountFallback = (data) =>
    Number(
      data?.totalRatings ??
      data?.ratings?.count ??
      data?.reviewCount ??
      data?.reviewsCount ??
      data?.stats?.totalRatings ??
      data?.analytics?.totalRatings ??
      0
    ) || 0

  useEffect(() => {
    const fetchLiveRatingSnapshot = async () => {
      try {
        const limit = 200
        const maxPages = 20
        let page = 1
        let hasMore = true
        const allOrders = []

        while (hasMore && page <= maxPages) {
          const response = await restaurantAPI.getOrders({ page, limit, status: "delivered" })
          const orders = response?.data?.data?.orders || []
          allOrders.push(...orders)

          const totalPages = response?.data?.data?.pagination?.totalPages || response?.data?.data?.totalPages || 1
          if (orders.length < limit || (totalPages > 0 && page >= totalPages)) {
            hasMore = false
          } else {
            page += 1
          }
        }

        const ratings = allOrders.map(extractOrderRating).filter((value) => value !== null)
        if (ratings.length === 0) {
          setRatingSnapshot({ average: 0, total: 0 })
          return
        }

        const avg = ratings.reduce((sum, value) => sum + value, 0) / ratings.length
        setRatingSnapshot({ average: Math.round(avg * 10) / 10, total: ratings.length })
      } catch (error) {
        // Keep fallback values from restaurant profile if live pull fails.
      }
    }

    fetchLiveRatingSnapshot()
  }, [restaurantData?._id, restaurantData?.id])

  const displayRating = ratingSnapshot.average ?? getRestaurantRatingFallback(restaurantData)
  const displayTotalRatings = ratingSnapshot.total ?? getRestaurantReviewCountFallback(restaurantData)

  const locationData = restaurantData?.location || {}
  const fullAddress = locationData.formattedAddress || locationData.address || address || ""

  return (
    <>
      <div className="min-h-screen bg-slate-50 overflow-x-hidden pb-8">
        {/* Header */}
        <div className="bg-white/95 backdrop-blur border-b border-gray-200 px-4 py-3 sticky top-0 z-50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 flex-1">
              <button onClick={goBack} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
                <ArrowLeft className="w-6 h-6 text-gray-900" />
              </button>
              <h1 className="text-lg font-bold text-gray-900">Outlet info</h1>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-900 font-normal">
                Restaurant id: {loading ? "Loading..." : formatRestaurantId(restaurantMongoId || restaurantId)}
              </span>
            </div>
          </div>
        </div>

        {/* Outlet Image Section */}
        <div className="relative w-full h-[200px] overflow-hidden">
          <img src={thumbnailImage} alt="Outlet" className="w-full h-full object-cover" />
          <input
            ref={menuImageInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => handleCoverImageAdd(Array.from(e.target.files || []))}
          />
          
          <input
            ref={profileImageInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleProfileImageReplace(e.target.files?.[0])}
          />

          <div className="absolute right-4 bottom-4 z-20 flex items-center gap-2">
            <button
              onClick={() => handleImageClick('profile', profileImageInputRef, "Add Outlet Image")}
              disabled={uploadingImage}
              className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white min-w-[90px] disabled:opacity-50"
            >
              {uploadingImage && imageType === 'profile' ? 'Uploading...' : 'Add image'}
            </button>
            <button
              onClick={handleProfileImageDelete}
              disabled={uploadingImage}
              className="inline-flex items-center justify-center rounded-lg bg-red-500 px-3 py-2 text-xs font-semibold text-white min-w-[90px] disabled:opacity-50"
            >
              Remove
            </button>
          </div>
        </div>

        <div className="px-4 pt-4 pb-3 bg-white border-b border-slate-200">
          <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 gap-3">
            <div className="flex gap-2 overflow-x-auto pb-1 flex-1">
              {coverImages.length > 0 ? (
                coverImages.map((img, index) => (
                  <button
                    key={`${img.url}-${index}`}
                    type="button"
                    onClick={() => setMainImage(img.url)}
                    className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border ${
                      mainImage === img.url ? "border-slate-900" : "border-slate-200"
                    }`}
                  >
                    <img src={img.url} alt={`Menu ${index + 1}`} className="h-full w-full object-cover" />
                  </button>
                ))
              ) : (
                <p className="text-xs text-slate-500 self-center">No images</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleImageClick('cover', menuImageInputRef, "Add Cover Image", true)}
                disabled={uploadingImage}
                className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white min-w-[86px] disabled:opacity-50"
              >
                {uploadingImage && imageType === 'menu' ? `Uploading ${uploadingCount}...` : 'Add image'}
              </button>
              <button
                onClick={() => {
                  const selectedIndex = coverImages.findIndex((img) => img.url === mainImage)
                  if (selectedIndex >= 0) handleCoverImageDelete(selectedIndex)
                }}
                disabled={uploadingImage || !coverImages.find((img) => img.url === mainImage)}
                className="inline-flex items-center justify-center rounded-lg bg-red-500 px-3 py-2 text-xs font-semibold text-white min-w-[86px] disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          </div>
        </div>



        <div className="px-4 py-4">
          <h2 className="text-base font-bold text-gray-900">Restaurant Information</h2>
          <p className="text-sm text-gray-500 mt-1">All onboarding and profile details at one place.</p>
        </div>

        <div className="px-4 pb-6 space-y-3">
          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-500 font-medium mb-1">Restaurant name</p>
                <p className="text-base font-semibold text-slate-900">{loading ? "Loading..." : direct(restaurantName)}</p>
              </div>
              <span className={`inline-flex items-center rounded-full px-2 py-1 text-[10px] font-semibold mr-2 ${getApprovalBadgeClass(getSectionStatus("name"))}`}>
                {getApprovalLabel(getSectionStatus("name"))}
              </span>
              <button onClick={handleOpenEditDialog} className="text-blue-600 text-sm font-medium">Edit</button>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-slate-900">Basic details</h3>
                <span className={`inline-flex items-center rounded-full px-2 py-1 text-[10px] font-semibold ${getApprovalBadgeClass(getSectionStatus("basic"))}`}>
                  {getApprovalLabel(getSectionStatus("basic"))}
                </span>
              </div>
              <button onClick={() => setShowEditBasicDialog(true)} className="text-blue-600 text-sm font-medium">Edit</button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><p className="text-xs text-slate-500">Owner name</p><p className="text-sm font-medium text-slate-900">{direct(restaurantData?.ownerName)}</p></div>
              <div><p className="text-xs text-slate-500">Primary contact</p><p className="text-sm font-medium text-slate-900">{direct(restaurantData?.primaryContactNumber)}</p></div>
              <div><p className="text-xs text-slate-500">Email</p><p className="text-sm font-medium text-slate-900">{direct(restaurantData?.ownerEmail)}</p></div>
              <div>
                <p className="text-xs text-slate-500">Restaurant type</p>
                <div className="mt-0.5 flex items-center gap-2">
                  <div
                    className={`h-4 w-4 rounded-sm border-2 flex items-center justify-center ${restaurantData?.pureVegRestaurant === true ? "" : "border-red-500"}`}
                    style={restaurantData?.pureVegRestaurant === true ? { borderColor: "#16A34A", backgroundColor: "#F0FDF4" } : undefined}
                  >
                    <div
                      className={`h-2 w-2 rounded-full ${restaurantData?.pureVegRestaurant === true ? "" : "bg-red-500"}`}
                      style={restaurantData?.pureVegRestaurant === true ? { backgroundColor: "#16A34A" } : undefined}
                    />
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${restaurantData?.pureVegRestaurant === true ? "" : "bg-rose-50 text-rose-700"}`}
                    style={restaurantData?.pureVegRestaurant === true ? { backgroundColor: "#ECFDF3", color: "#15803D" } : undefined}
                  >
                    {restaurantData?.pureVegRestaurant === true ? "Pure Veg" : "Mixed"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-slate-900">Address and location</h3>
                <span className={`inline-flex items-center rounded-full px-2 py-1 text-[10px] font-semibold ${getApprovalBadgeClass(getSectionStatus("address"))}`}>
                  {getApprovalLabel(getSectionStatus("address"))}
                </span>
              </div>
              <button onClick={() => setShowEditAddressDialog(true)} className="text-blue-600 text-sm font-medium">Edit</button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><p className="text-xs text-slate-500">Shop no. / building no. *</p><p className="text-sm font-medium text-slate-900">{direct(restaurantData?.location?.addressLine1 || restaurantData?.addressLine1)}</p></div>
                <div><p className="text-xs text-slate-500">Floor / tower *</p><p className="text-sm font-medium text-slate-900">{direct(restaurantData?.location?.addressLine2 || restaurantData?.addressLine2 || "—")}</p></div>
                <div><p className="text-xs text-slate-500">Nearby landmark *</p><p className="text-sm font-medium text-slate-900">{direct(restaurantData?.location?.landmark || restaurantData?.landmark || "—")}</p></div>
                <div><p className="text-xs text-slate-500">Area / Sector / Locality*</p><p className="text-sm font-medium text-slate-900">{direct(restaurantData?.location?.area || restaurantData?.area)}</p></div>
                <div><p className="text-xs text-slate-500">City *</p><p className="text-sm font-medium text-slate-900">{direct(restaurantData?.location?.city || restaurantData?.city)}</p></div>
                <div><p className="text-xs text-slate-500">State *</p><p className="text-sm font-medium text-slate-900">{direct(restaurantData?.location?.state || restaurantData?.state)}</p></div>
                <div><p className="text-xs text-slate-500">Pincode *</p><p className="text-sm font-medium text-slate-900">{direct(restaurantData?.location?.pincode || restaurantData?.pincode)}</p></div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-slate-900">Compliance details</h3>
                <span className={`inline-flex items-center rounded-full px-2 py-1 text-[10px] font-semibold ${getApprovalBadgeClass(getSectionStatus("compliance"))}`}>
                  {getApprovalLabel(getSectionStatus("compliance"))}
                </span>
              </div>
              <button onClick={() => setShowEditComplianceDialog(true)} className="text-blue-600 text-sm font-medium">Edit</button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><p className="text-xs text-slate-500">PAN number</p><p className="text-sm font-medium text-slate-900">{direct(restaurantData?.panNumber)}</p></div>
              <div><p className="text-xs text-slate-500">GST registered</p><p className="text-sm font-medium text-slate-900">{isGstRegistered ? "Yes" : "No"}</p></div>
              {isGstRegistered ? (
                <>
                  <div><p className="text-xs text-slate-500">GST number</p><p className="text-sm font-medium text-slate-900">{direct(restaurantData?.gstNumber)}</p></div>
                  <div><p className="text-xs text-slate-500">GST legal name</p><p className="text-sm font-medium text-slate-900">{direct(restaurantData?.gstLegalName)}</p></div>
                  <div className="sm:col-span-2"><p className="text-xs text-slate-500">GST address</p><p className="text-sm font-medium text-slate-900">{direct(restaurantData?.gstAddress)}</p></div>
                  <div className="sm:col-span-2">
                    <p className="text-xs text-slate-500">GST document</p>
                    <div className="mt-1 flex items-center gap-3">
                      {gstDocUrl ? (
                        getViewLabel(gstDocUrl) === "View pdf" ? (
                          <a href={gstDocUrl} target="_blank" rel="noreferrer" className="text-sm font-semibold text-blue-600 hover:text-blue-700 underline underline-offset-2">
                            {getViewLabel(gstDocUrl)}
                          </a>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openImagePreview(gstDocUrl)}
                            className="text-sm font-semibold text-blue-600 hover:text-blue-700 underline underline-offset-2"
                          >
                            View image
                          </button>
                        )
                      ) : (
                        <p className="text-sm font-medium text-slate-900">Not uploaded</p>
                      )}
                      <input
                        ref={gstDocInputRef}
                        type="file"
                        accept="image/*,.pdf"
                        className="hidden"
                        onChange={(e) => handleComplianceDocUpload("gst", e.target.files?.[0])}
                      />
                      <button
                        onClick={() => handleDocImageClick("gst", gstDocInputRef, "Upload GST Document")}
                        className="text-xs font-semibold text-blue-600"
                        disabled={uploadingDocType === "gst"}
                      >
                        {uploadingDocType === "gst" ? "Uploading..." : "Upload"}
                      </button>
                    </div>
                  </div>
                </>
              ) : null}
              <div><p className="text-xs text-slate-500">FSSAI number</p><p className="text-sm font-medium text-slate-900">{direct(restaurantData?.fssaiNumber)}</p></div>
              <div><p className="text-xs text-slate-500">FSSAI expiry</p><p className="text-sm font-medium text-slate-900">{formatDate(restaurantData?.fssaiExpiry)}</p></div>
              <div className="sm:col-span-2">
                <p className="text-xs text-slate-500">FSSAI document</p>
                <div className="mt-1 flex items-center gap-3">
                  {fssaiDocUrl ? (
                    getViewLabel(fssaiDocUrl) === "View pdf" ? (
                      <a href={fssaiDocUrl} target="_blank" rel="noreferrer" className="text-sm font-semibold text-blue-600 hover:text-blue-700 underline underline-offset-2">
                        {getViewLabel(fssaiDocUrl)}
                      </a>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openImagePreview(fssaiDocUrl)}
                        className="text-sm font-semibold text-blue-600 hover:text-blue-700 underline underline-offset-2"
                      >
                        View image
                      </button>
                    )
                  ) : (
                    <p className="text-sm font-medium text-slate-900">Not uploaded</p>
                  )}
                  <input
                    ref={fssaiDocInputRef}
                    type="file"
                    accept="image/*,.pdf"
                    className="hidden"
                    onChange={(e) => handleComplianceDocUpload("fssai", e.target.files?.[0])}
                  />
                  <button
                    onClick={() => handleDocImageClick("fssai", fssaiDocInputRef, "Upload FSSAI Document")}
                    className="text-xs font-semibold text-blue-600"
                    disabled={uploadingDocType === "fssai"}
                  >
                    {uploadingDocType === "fssai" ? "Uploading..." : "Upload"}
                  </button>
                </div>
              </div>
              <div className="sm:col-span-2">
                <p className="text-xs text-slate-500">PAN document</p>
                <div className="mt-1 flex items-center gap-3">
                  {panDocUrl ? (
                    getViewLabel(panDocUrl) === "View pdf" ? (
                      <a href={panDocUrl} target="_blank" rel="noreferrer" className="text-sm font-semibold text-blue-600 hover:text-blue-700 underline underline-offset-2">
                        {getViewLabel(panDocUrl)}
                      </a>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openImagePreview(panDocUrl)}
                        className="text-sm font-semibold text-blue-600 hover:text-blue-700 underline underline-offset-2"
                      >
                        View image
                      </button>
                    )
                  ) : (
                    <p className="text-sm font-medium text-slate-900">Not uploaded</p>
                  )}
                  <input
                    ref={panDocInputRef}
                    type="file"
                    accept="image/*,.pdf"
                    className="hidden"
                    onChange={(e) => handleComplianceDocUpload("pan", e.target.files?.[0])}
                  />
                  <button
                    onClick={() => handleDocImageClick("pan", panDocInputRef, "Upload PAN Document")}
                    className="text-xs font-semibold text-blue-600"
                    disabled={uploadingDocType === "pan"}
                  >
                    {uploadingDocType === "pan" ? "Uploading..." : "Upload"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-slate-900">Bank and UPI details</h3>
                <span className={`inline-flex items-center rounded-full px-2 py-1 text-[10px] font-semibold ${getApprovalBadgeClass(getSectionStatus("bank"))}`}>
                  {getApprovalLabel(getSectionStatus("bank"))}
                </span>
              </div>
              <button onClick={() => setShowEditBankDialog(true)} className="text-blue-600 text-sm font-medium">Edit</button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><p className="text-xs text-slate-500">Account holder</p><p className="text-sm font-medium text-slate-900">{direct(restaurantData?.accountHolderName)}</p></div>
              <div><p className="text-xs text-slate-500">Account number</p><p className="text-sm font-medium text-slate-900">{maskAccountNumber(restaurantData?.accountNumber)}</p></div>
              <div><p className="text-xs text-slate-500">IFSC code</p><p className="text-sm font-medium text-slate-900">{direct(restaurantData?.ifscCode)}</p></div>
              <div><p className="text-xs text-slate-500">UPI ID</p><p className="text-sm font-medium text-slate-900">{direct(restaurantData?.upiId)}</p></div>
              <div className="sm:col-span-2">
                <p className="text-xs text-slate-500">UPI QR image</p>
                {String(restaurantData?.upiQrImage?.url || restaurantData?.upiQrImage || "").trim() ? (
                  <button
                    type="button"
                    onClick={() => openImagePreview(String(restaurantData?.upiQrImage?.url || restaurantData?.upiQrImage || "").trim())}
                    className="text-sm font-semibold text-blue-600 hover:text-blue-700 underline underline-offset-2"
                  >
                    View
                  </button>
                ) : (
                  <p className="text-sm font-medium text-slate-900">Not uploaded</p>
                )}
              </div>
            </div>
          </div>

        </div>
      </div>

      <Dialog open={showEditNameDialog} onOpenChange={setShowEditNameDialog}>
        <DialogContent className="sm:max-w-md p-0 overflow-hidden rounded-xl w-[90%]">
          <DialogHeader className="p-4 border-b border-gray-100"><DialogTitle className="text-lg font-bold">Edit restaurant name</DialogTitle></DialogHeader>
          <div className="p-4"><Input value={editNameValue} onChange={(e) => setEditNameValue(e.target.value)} placeholder="Enter restaurant name" className="w-full" /></div>
          <DialogFooter className="p-4 bg-gray-50 flex flex-row gap-3">
            <Button variant="outline" onClick={() => setShowEditNameDialog(false)}>Cancel</Button>
            <Button onClick={handleSaveName} disabled={!editNameValue.trim()} className="bg-blue-600 text-white">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showEditBasicDialog} onOpenChange={setShowEditBasicDialog}>
        <DialogContent className="sm:max-w-md p-0 overflow-hidden rounded-xl w-[90%]">
          <DialogHeader className="p-4 border-b border-gray-100">
            <DialogTitle className="text-lg font-bold">Edit basic details</DialogTitle>
          </DialogHeader>
          <div className="p-4 space-y-3">
            <div>
              <p className="text-xs text-slate-500 mb-1">Owner name</p>
              <Input
                value={basicForm.ownerName}
                onChange={(e) =>
                  setBasicForm((prev) => ({
                    ...prev,
                    ownerName: e.target.value.replace(/[^A-Za-z\s]/g, "").replace(/\s{2,}/g, " "),
                  }))
                }
                placeholder="Enter owner name"
              />
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Primary contact</p>
              <Input
                value={basicForm.primaryContactNumber}
                readOnly
                disabled
                placeholder="Enter primary contact"
              />
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Email</p>
              <Input
                value={basicForm.ownerEmail}
                onChange={(e) =>
                  setBasicForm((prev) => ({
                    ...prev,
                    ownerEmail: e.target.value.replace(/\s/g, "").toLowerCase(),
                  }))
                }
                placeholder="Enter email"
              />
            </div>
          </div>
          <DialogFooter className="p-4 bg-gray-50 flex flex-row gap-3">
            <Button variant="outline" onClick={() => setShowEditBasicDialog(false)}>Cancel</Button>
            <Button onClick={handleSaveBasicDetails} disabled={savingBasic} className="bg-blue-600 text-white">
              {savingBasic ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showEditComplianceDialog} onOpenChange={setShowEditComplianceDialog}>
        <DialogContent className="sm:max-w-lg p-0 overflow-hidden rounded-xl w-[92%]">
          <DialogHeader className="p-4 border-b border-gray-100">
            <DialogTitle className="text-lg font-bold">Edit compliance details</DialogTitle>
          </DialogHeader>
          <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
            <div>
              <p className="text-xs text-slate-500 mb-1">PAN number</p>
              <Input
                value={complianceForm.panNumber}
                onChange={(e) =>
                  setComplianceForm((prev) => ({
                    ...prev,
                    panNumber: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10),
                  }))
                }
                placeholder="Enter PAN number"
              />
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">GST registered</p>
              <select
                value={complianceForm.gstRegistered ? "yes" : "no"}
                onChange={(e) => setComplianceForm((prev) => ({ ...prev, gstRegistered: e.target.value === "yes" }))}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>
            {complianceForm.gstRegistered ? (
              <>
                <div>
                  <p className="text-xs text-slate-500 mb-1">GST number</p>
                  <Input
                    value={complianceForm.gstNumber}
                    onChange={(e) =>
                      setComplianceForm((prev) => ({
                        ...prev,
                        gstNumber: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 15),
                      }))
                    }
                    placeholder="Enter GST number"
                  />
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">GST legal name</p>
                  <Input
                    value={complianceForm.gstLegalName}
                    onChange={(e) => setComplianceForm((prev) => ({ ...prev, gstLegalName: e.target.value }))}
                    placeholder="Enter GST legal name"
                  />
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">GST address</p>
                  <Input
                    value={complianceForm.gstAddress}
                    onChange={(e) => setComplianceForm((prev) => ({ ...prev, gstAddress: e.target.value }))}
                    placeholder="Enter GST address"
                  />
                </div>
              </>
            ) : null}
            <div>
              <p className="text-xs text-slate-500 mb-1">FSSAI number</p>
              <Input
                value={complianceForm.fssaiNumber}
                onChange={(e) =>
                  setComplianceForm((prev) => ({
                    ...prev,
                    fssaiNumber: e.target.value.replace(/\D/g, "").slice(0, 14),
                  }))
                }
                placeholder="Enter FSSAI number"
              />
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">FSSAI expiry</p>
              <Input
                type="date"
                value={complianceForm.fssaiExpiry}
                onChange={(e) => setComplianceForm((prev) => ({ ...prev, fssaiExpiry: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter className="p-4 bg-gray-50 flex flex-row gap-3">
            <Button variant="outline" onClick={() => setShowEditComplianceDialog(false)}>Cancel</Button>
            <Button onClick={handleSaveCompliance} disabled={savingCompliance} className="bg-blue-600 text-white">
              {savingCompliance ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showEditBankDialog} onOpenChange={setShowEditBankDialog}>
        <DialogContent className="sm:max-w-lg p-0 overflow-hidden rounded-xl w-[92%]">
          <DialogHeader className="p-4 border-b border-gray-100">
            <DialogTitle className="text-lg font-bold">Edit bank & UPI details</DialogTitle>
          </DialogHeader>
          <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
            <div>
              <p className="text-xs text-slate-500 mb-1">Account holder name</p>
              <Input
                value={bankForm.accountHolderName}
                onChange={(e) =>
                  setBankForm((prev) => ({
                    ...prev,
                    accountHolderName: e.target.value.replace(/[^A-Za-z\s]/g, "").replace(/\s{2,}/g, " "),
                  }))
                }
                placeholder="Enter account holder name"
              />
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Account number</p>
              <Input
                value={bankForm.accountNumber}
                onChange={(e) => setBankForm((prev) => ({ ...prev, accountNumber: e.target.value.replace(/\D/g, "").slice(0, 18) }))}
                placeholder="Enter account number"
              />
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Confirm account number</p>
              <Input
                value={bankForm.confirmAccountNumber}
                onChange={(e) => setBankForm((prev) => ({ ...prev, confirmAccountNumber: e.target.value.replace(/\D/g, "").slice(0, 18) }))}
                placeholder="Re-enter account number"
              />
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">IFSC code</p>
              <Input
                value={bankForm.ifscCode}
                onChange={(e) =>
                  setBankForm((prev) => ({
                    ...prev,
                    ifscCode: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 11),
                  }))
                }
                placeholder="e.g. SBIN0018764"
              />
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">UPI ID</p>
              <Input
                value={bankForm.upiId}
                onChange={(e) => setBankForm((prev) => ({ ...prev, upiId: e.target.value }))}
                placeholder="e.g. merchant@okaxis"
              />
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">UPI QR image</p>
              <div className="flex items-center gap-3">
                {bankForm.upiQrImage ? (
                  <a href={bankForm.upiQrImage} target="_blank" rel="noreferrer" className="text-sm font-semibold text-blue-600 hover:text-blue-700 underline underline-offset-2">
                    View image
                  </a>
                ) : (
                  <p className="text-sm text-slate-600">Not uploaded</p>
                )}
                <input
                  ref={bankQrInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleBankQrUpload(e.target.files?.[0])}
                />
                <button
                  onClick={() => {
                    if (isFlutterBridgeAvailable()) {
                      setActivePicker({
                        type: "upi-qr",
                        ref: bankQrInputRef,
                        title: "Upload UPI QR",
                        multiple: false,
                        onFileSelect: (file) => handleBankQrUpload(file),
                        description: "Choose how to upload your UPI QR image",
                        fileNamePrefix: "outlet-upi-qr",
                      })
                    } else {
                      bankQrInputRef.current?.click()
                    }
                  }}
                  className="text-xs font-semibold text-blue-600"
                  disabled={uploadingBankQr}
                >
                  {uploadingBankQr ? "Uploading..." : "Upload"}
                </button>
              </div>
            </div>
          </div>
          <DialogFooter className="p-4 bg-gray-50 flex flex-row gap-3">
            <Button variant="outline" onClick={() => setShowEditBankDialog(false)}>Cancel</Button>
            <Button onClick={handleSaveBankDetails} disabled={savingBank || uploadingBankQr} className="bg-blue-600 text-white">
              {savingBank ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {previewImageUrl ? (
        <div className="fixed inset-0 z-[120] bg-black/70 flex items-center justify-center p-4">
          <div className="relative w-full max-w-3xl bg-white rounded-xl p-3">
            <button
              type="button"
              onClick={() => setPreviewImageUrl("")}
              className="absolute -top-3 -right-3 h-8 w-8 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-700"
              aria-label="Close preview"
            >
              <X size={16} />
            </button>
            <img
              src={previewImageUrl}
              alt="Preview"
              className="w-full max-h-[80vh] object-contain rounded-md"
            />
          </div>
        </div>
      ) : null}

      <Dialog open={showEditAddressDialog} onOpenChange={setShowEditAddressDialog}>
        <DialogContent className="sm:max-w-lg p-0 overflow-hidden rounded-xl w-[92%]">
          <DialogHeader className="p-4 border-b border-gray-100">
            <DialogTitle className="text-lg font-bold">Edit address details</DialogTitle>
          </DialogHeader>
          <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
            {/* Search location bar */}
            <div>
              <p className="text-xs text-slate-500 mb-1 font-semibold">Search location</p>
              <div className="relative">
                <Input
                  ref={locationSearchInputRef}
                  value={locationSearchValue}
                  onChange={(e) => {
                    const val = e.target.value
                    setLocationSearchValue(val)
                    if (!val.trim()) {
                      setAddressForm({
                        addressLine1: "",
                        addressLine2: "",
                        area: "",
                        city: "",
                        state: "",
                        pincode: "",
                        landmark: "",
                        latitude: "",
                        longitude: "",
                        zoneId: "",
                      })
                      setLocationSuggestions([])
                      setZoneDetectionState({ status: "idle", message: "", zoneName: "" })
                    } else {
                      setZoneDetectionState((prev) =>
                        prev.status === "idle" ? prev : { status: "idle", message: "", zoneName: "" }
                      )
                    }
                  }}
                  className="bg-white text-sm text-black placeholder:text-gray-400"
                  placeholder="Start typing your restaurant address..."
                />
                {isSearchingLocation && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-orange-500 border-t-transparent" />
                  </div>
                )}
              </div>

              {/* Suggestions Dropdown */}
              {locationSuggestions.length > 0 && (
                <div className="relative">
                  <div className="absolute left-0 right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-xl z-[9999] overflow-hidden max-h-60 overflow-y-auto">
                    {locationSuggestions.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={async () => {
                          if (s.source === "google" && s.placeId && placesDetailsServiceRef.current && window.google?.maps?.places?.PlacesServiceStatus) {
                            try {
                              const place = await new Promise((resolve, reject) => {
                                placesDetailsServiceRef.current.getDetails(
                                  {
                                    placeId: s.placeId,
                                    fields: ["formatted_address", "address_components", "geometry"],
                                    sessionToken: placesSessionTokenRef.current || undefined,
                                  },
                                  (result, status) => {
                                    if (status === window.google.maps.places.PlacesServiceStatus.OK && result) {
                                      resolve(result)
                                      return
                                    }
                                    reject(new Error(String(status || "Failed to fetch place details")))
                                  }
                                )
                              })

                              const comps = Array.isArray(place?.address_components) ? place.address_components : []
                              const get = (types) => comps.find((c) => types.some((t) => c.types?.includes(t)))?.long_name || ""
                              const formattedAddress = place?.formatted_address || s.display || ""
                              const area = get(["sublocality_level_1", "sublocality", "neighborhood"]) || get(["locality"])
                              const city = get(["locality"]) || get(["administrative_area_level_2"])
                              const state = get(["administrative_area_level_1"]) || get(["administrative_area_level_2"])
                              const pincode = get(["postal_code"])
                              const lat = place?.geometry?.location?.lat?.()
                              const lng = place?.geometry?.location?.lng?.()

                              const resolvedPincode = pincode || (typeof lat === "number" && typeof lng === "number" ? await fetchPincodeFromLatLng(lat, lng) : "")

                              setAddressForm((prev) => ({
                                ...prev,
                                area: area || prev.area,
                                city: city || prev.city,
                                state: state || prev.state,
                                pincode: resolvedPincode || prev.pincode,
                                latitude: typeof lat === "number" ? Number(lat.toFixed(6)) : prev.latitude,
                                longitude: typeof lng === "number" ? Number(lng.toFixed(6)) : prev.longitude,
                              }))
                              suppressSuggestionFetchRef.current = true
                              setLocationSearchValue(formattedAddress)
                              setLocationSuggestions([])
                              locationSearchInputRef.current?.blur()
                              if (window.google?.maps?.places?.AutocompleteSessionToken) {
                                placesSessionTokenRef.current = new window.google.maps.places.AutocompleteSessionToken()
                              }
                              await detectAndSetZoneForLocation(lat, lng)
                              return
                            } catch (err) {
                              debugError("Google place details failed, falling back to manual suggestion mapping:", err)
                            }
                          }

                          const { lat, lng, display, addr = {} } = s
                          const area = addr.suburb || addr.neighbourhood || addr.city_district || addr.locality || ""
                          const city = addr.city || addr.town || addr.village || ""
                          const state = addr.state || ""
                          const pincode = addr.postcode || ""

                          const resolvedPincode = pincode || (Number.isFinite(lat) && Number.isFinite(lng) ? await fetchPincodeFromLatLng(lat, lng) : "")

                          setAddressForm((prev) => ({
                            ...prev,
                            area: area || prev.area,
                            city: city || prev.city,
                            state: state || prev.state,
                            pincode: resolvedPincode || prev.pincode,
                            latitude: Number.isFinite(lat) ? lat : prev.latitude,
                            longitude: Number.isFinite(lng) ? lng : prev.longitude,
                          }))
                          suppressSuggestionFetchRef.current = true
                          setLocationSearchValue(display)
                          setLocationSuggestions([])
                          locationSearchInputRef.current?.blur()
                          await detectAndSetZoneForLocation(lat, lng)
                        }}
                        className="w-full px-4 py-2 text-left text-[13px] hover:bg-orange-50 border-b border-gray-100 last:border-none font-medium text-gray-700"
                      >
                        <span className="block truncate text-black">{s.mainText || s.display}</span>
                        {s.secondaryText && (
                          <span className="block truncate text-[11px] text-gray-500">{s.secondaryText}</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Zone status banner */}
            {zoneDetectionState.status === "detecting" && (
              <p className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700">
                Detecting service zone...
              </p>
            )}
            {zoneDetectionState.status === "matched" && (
              <p className="rounded-md border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-700">
                {zoneDetectionState.message}
              </p>
            )}
            {zoneDetectionState.status === "out_of_zone" && (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700">
                No active zone found at this location. All fields cleared.
              </p>
            )}
            {zoneDetectionState.status === "failed" && (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700">
                {zoneDetectionState.message}
              </p>
            )}

            {/* Address Form Fields */}
            <div>
              <p className="text-xs text-slate-500 mb-1">Shop no. / building no. <span className="text-red-500">*</span></p>
              <Input
                value={addressForm.addressLine1}
                onChange={(e) => setAddressForm((prev) => ({ ...prev, addressLine1: e.target.value }))}
                placeholder="Shop no. / building no."
              />
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Floor / tower <span className="text-red-500">*</span></p>
              <Input
                value={addressForm.addressLine2}
                onChange={(e) => setAddressForm((prev) => ({ ...prev, addressLine2: e.target.value }))}
                placeholder="Floor / tower"
              />
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Nearby landmark <span className="text-red-500">*</span></p>
              <Input
                value={addressForm.landmark}
                onChange={(e) => setAddressForm((prev) => ({ ...prev, landmark: e.target.value }))}
                placeholder="Nearby landmark"
              />
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Area / Sector / Locality <span className="text-red-500">*</span></p>
              <Input
                value={addressForm.area}
                readOnly
                className="bg-gray-50 text-slate-600 cursor-not-allowed"
                placeholder="Area / Sector / Locality"
              />
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">City <span className="text-red-500">*</span></p>
              <Input
                value={addressForm.city}
                readOnly
                className="bg-gray-50 text-slate-600 cursor-not-allowed"
                placeholder="City"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-slate-500 mb-1">State <span className="text-red-500">*</span></p>
                <Input
                  value={addressForm.state}
                  readOnly
                  className="bg-gray-50 text-slate-600 cursor-not-allowed"
                  placeholder="State"
                />
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Pincode <span className="text-red-500">*</span></p>
                <Input
                  value={addressForm.pincode}
                  readOnly
                  className="bg-gray-50 text-slate-600 cursor-not-allowed"
                  placeholder="Pincode"
                />
              </div>
            </div>
            <p className="text-[11px] text-gray-500 mt-1">
              Please ensure that this address is the same as mentioned on your FSSAI license.
            </p>
          </div>
          <DialogFooter className="p-4 bg-gray-50 flex flex-row gap-3">
            <Button variant="outline" onClick={() => setShowEditAddressDialog(false)}>Cancel</Button>
            <Button onClick={handleSaveAddressDetails} disabled={savingAddress} className="bg-blue-600 text-white">
              {savingAddress ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
 

      <ImageSourcePicker
        isOpen={!!activePicker}
        onClose={() => setActivePicker(null)}
        onFileSelect={(file) => {
          if (activePicker?.onFileSelect) {
            activePicker.onFileSelect(file)
          } else if (activePicker?.type === 'profile') {
            handleProfileImageReplace(file)
          } else {
            handleCoverImageAdd(file)
          }
        }}
        title={activePicker?.title}
        description={activePicker?.description || `Choose how to upload your ${activePicker?.type} photo`}
        fileNamePrefix={activePicker?.fileNamePrefix || `outlet-${activePicker?.type}`}
        galleryInputRef={activePicker?.ref}
      />
    </>
  )
}
