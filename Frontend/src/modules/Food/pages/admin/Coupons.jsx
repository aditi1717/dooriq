import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import { Check, ChevronDown, Pencil, Search, Users, X } from "lucide-react"
import { adminAPI } from "@food/api"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}

function StyledSelect({ value, options, onChange, ariaLabel }) {
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef(null)
  const selectedOption = options.find((option) => option.value === value) || options[0]

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setIsOpen(false)
      }
    }
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setIsOpen(false)
    }
    document.addEventListener("mousedown", handleOutsideClick)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={`flex min-h-11 w-full items-center justify-between rounded-xl border bg-white px-3.5 py-2.5 text-left text-sm font-medium text-slate-700 shadow-sm outline-none transition hover:border-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 ${
          isOpen ? "border-blue-500 ring-4 ring-blue-100" : "border-slate-200"
        }`}
      >
        <span>{selectedOption?.label}</span>
        <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen && (
        <div
          role="listbox"
          className="absolute z-40 mt-2 w-full overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-[0_16px_40px_rgba(15,23,42,0.16)]"
        >
          {options.map((option) => {
            const selected = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(option.value)
                  setIsOpen(false)
                }}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm font-medium transition ${
                  selected
                    ? "bg-blue-50 text-blue-700"
                    : "text-slate-700 hover:bg-slate-50 hover:text-slate-950"
                }`}
              >
                <span>{option.label}</span>
                {selected && <Check className="h-4 w-4 text-blue-600" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}


/**
 * Customer picker for user-specific coupons.
 *
 * Searches server-side rather than loading every customer: the restaurant list
 * is a few hundred rows and can be held in memory, but the customer list is
 * unbounded. Selected customers are kept in local state so their chips survive
 * a search that no longer returns them.
 */
function CustomerMultiSelect({ value, selectedDetails, onChange, error }) {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const rootRef = useRef(null)

  const selectedIds = useMemo(
    () => (Array.isArray(value) ? value.map((v) => String(v?._id || v?.id || v)).filter(Boolean) : []),
    [value],
  )
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])

  // Remember every customer we have seen so chips keep their names when the
  // search results change underneath them.
  const knownRef = useRef(new Map())
  useEffect(() => {
    for (const customer of selectedDetails || []) {
      if (customer?.id) knownRef.current.set(String(customer.id), customer)
    }
  }, [selectedDetails])
  useEffect(() => {
    for (const customer of results) {
      if (customer?.id) knownRef.current.set(String(customer.id), customer)
    }
  }, [results])

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setIsOpen(false)
    }
    document.addEventListener("mousedown", handleOutsideClick)
    return () => document.removeEventListener("mousedown", handleOutsideClick)
  }, [])

  useEffect(() => {
    if (!isOpen) return undefined
    let cancelled = false
    setSearching(true)
    const timer = setTimeout(async () => {
      try {
        const response = await adminAPI.getCustomers({ page: 1, limit: 25, search: query.trim() })
        const payload = response?.data?.data
        const rows = payload?.customers || payload?.users || payload?.data || (Array.isArray(payload) ? payload : [])
        if (!cancelled) {
          setResults(rows.map((row) => ({
            id: String(row._id || row.id || ""),
            name: row.name || row.fullName || "Unnamed customer",
            phone: row.phone || row.mobile || "",
            email: row.email || "",
          })).filter((row) => row.id))
        }
      } catch {
        if (!cancelled) setResults([])
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 300)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [query, isOpen])

  const toggleCustomer = (id) => {
    const key = String(id)
    onChange(selectedSet.has(key)
      ? selectedIds.filter((selectedId) => selectedId !== key)
      : [...selectedIds, key])
  }

  const chips = selectedIds.map((id) => knownRef.current.get(id) || { id, name: "Selected customer", phone: "" })

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        className={`flex min-h-11 w-full items-center justify-between rounded-xl border bg-white px-3.5 py-2.5 text-left text-sm shadow-sm outline-none transition ${
          error ? "border-red-500" : "border-slate-200 hover:border-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
        }`}
      >
        <span className={selectedIds.length ? "font-medium text-slate-700" : "text-slate-400"}>
          {selectedIds.length
            ? `${selectedIds.length} customer${selectedIds.length === 1 ? "" : "s"} selected`
            : "Search and choose customers"}
        </span>
        <ChevronDown className={`h-4 w-4 text-slate-400 transition ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen && (
        <div className="absolute z-30 mt-2 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="border-b border-slate-100 p-2.5">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by name, phone or email..."
                className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                autoFocus
              />
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto p-1.5">
            {searching && <p className="px-3 py-6 text-center text-sm text-slate-500">Searching...</p>}
            {!searching && results.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-slate-500">No customers found</p>
            )}
            {!searching && results.map((customer) => {
              const selected = selectedSet.has(customer.id)
              return (
                <button
                  key={customer.id}
                  type="button"
                  onClick={() => toggleCustomer(customer.id)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${
                    selected ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                    selected ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white"
                  }`}>
                    {selected && <Check className="h-3.5 w-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{customer.name}</span>
                    {(customer.phone || customer.email) && (
                      <span className="block truncate text-xs text-slate-500">
                        {[customer.phone, customer.email].filter(Boolean).join(" | ")}
                      </span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {chips.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {chips.map((customer) => (
            <span key={customer.id} className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700">
              {customer.name}{customer.phone ? ` (${customer.phone})` : ""}
              <button
                type="button"
                onClick={() => toggleCustomer(customer.id)}
                aria-label={`Remove ${customer.name}`}
                className="rounded-full p-0.5 hover:bg-blue-100"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function RestaurantMultiSelect({ restaurants, value, onChange, error }) {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState("")
  const rootRef = useRef(null)
  const selectedIds = useMemo(() => {
    const list = Array.isArray(value) ? value : []
    return list
      .map((item) => {
        if (typeof item === "object" && item) return String(item._id || item.id || item.restaurantId || "")
        const s = String(item).trim()
        return s === "[object Object]" ? "" : s
      })
      .filter(Boolean)
  }, [value])
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const selectedRestaurants = useMemo(
    () => restaurants.filter((restaurant) => {
      const rid = String(restaurant._id || restaurant.id || restaurant.restaurantId || "")
      return selectedSet.has(rid)
    }),
    [restaurants, selectedSet],
  )
  const filteredRestaurants = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return restaurants
    return restaurants.filter((restaurant) =>
      String(restaurant.name || "").toLowerCase().includes(normalizedQuery),
    )
  }, [query, restaurants])

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setIsOpen(false)
      }
    }
    document.addEventListener("mousedown", handleOutsideClick)
    return () => document.removeEventListener("mousedown", handleOutsideClick)
  }, [])

  const toggleRestaurant = (restaurantId) => {
    const id = String(restaurantId)
    onChange(selectedSet.has(id)
      ? selectedIds.filter((selectedId) => selectedId !== id)
      : [...selectedIds, id])
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        className={`flex min-h-11 w-full items-center justify-between rounded-xl border bg-white px-3.5 py-2.5 text-left text-sm shadow-sm outline-none transition ${
          error ? "border-red-500" : "border-slate-200 hover:border-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
        }`}
      >
        <span className={selectedIds.length ? "font-medium text-slate-700" : "text-slate-400"}>
          {selectedIds.length
            ? `${selectedIds.length} restaurant${selectedIds.length === 1 ? "" : "s"} selected`
            : "Choose restaurants"}
        </span>
        <ChevronDown className={`h-4 w-4 text-slate-400 transition ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen && (
        <div className="absolute z-30 mt-2 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="border-b border-slate-100 p-2.5">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search restaurants..."
                className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                autoFocus
              />
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto p-1.5">
            {filteredRestaurants.length > 0 ? filteredRestaurants.map((restaurant) => {
              const id = String(restaurant._id)
              const selected = selectedSet.has(id)
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggleRestaurant(id)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${
                    selected ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                    selected ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white"
                  }`}>
                    {selected && <Check className="h-3.5 w-3.5" />}
                  </span>
                  <span className="truncate font-medium">{restaurant.name || "Unnamed restaurant"}</span>
                </button>
              )
            }) : (
              <p className="px-3 py-6 text-center text-sm text-slate-500">No restaurants found</p>
            )}
          </div>
        </div>
      )}

      {selectedRestaurants.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {selectedRestaurants.map((restaurant) => {
            const id = String(restaurant._id)
            return (
              <span key={id} className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700">
                {restaurant.name}
                <button
                  type="button"
                  onClick={() => toggleRestaurant(id)}
                  aria-label={`Remove ${restaurant.name}`}
                  className="rounded-full p-0.5 hover:bg-blue-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function Coupons() {
  const [searchQuery, setSearchQuery] = useState("")
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 10
  const [offers, setOffers] = useState([])
  const [restaurants, setRestaurants] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [editingOfferId, setEditingOfferId] = useState(null)
  const [submitError, setSubmitError] = useState("")
  const [submitSuccess, setSubmitSuccess] = useState("")
  const [updatingCartVisibility, setUpdatingCartVisibility] = useState({})
  const [deletingOffer, setDeletingOffer] = useState({})
  const [errors, setErrors] = useState({})
  // Names/phones for the customers already attached to the coupon being edited,
  // so their chips render properly before any search has run.
  const [editingTargetedUsers, setEditingTargetedUsers] = useState([])
  const [usageModal, setUsageModal] = useState(null)
  const [usageLoading, setUsageLoading] = useState(false)
  const [usageError, setUsageError] = useState("")
  const [formData, setFormData] = useState({
    couponCode: "",
    discountType: "percentage",
    discountValue: "",
    customerScope: "all",
    userIds: [],
    restaurantScope: "all",
    restaurantIds: [],
    endDate: "",
    startDate: "",
    minOrderValue: "",
    maxDiscount: "",
    usageLimit: "",
    perUserLimit: "",
    isFirstOrderOnly: false,
    adminBearPercentage: "100",
    restaurantBearPercentage: "0",
  })

  const fetchOffers = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await adminAPI.getAllOffers({})

      if (response?.data?.success) {
        setOffers(response.data.data.offers || [])
      } else {
        setError("Failed to fetch offers")
      }
    } catch (err) {
      debugError("Error fetching offers:", err)
      setError(err?.response?.data?.message || "Failed to fetch offers")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchOffers()
  }, [fetchOffers])

  useEffect(() => {
    const fetchRestaurants = async () => {
      try {
        const response = await adminAPI.getRestaurants({ page: 1, limit: 1000 })
        if (response?.data?.success) {
          const list = response?.data?.data?.restaurants || []
          // Backend returns `restaurantName`; normalize to `name` for this dropdown without affecting other pages.
          const normalized = Array.isArray(list)
            ? list.map((r) => ({
              ...r,
              name: r?.name || r?.restaurantName || "",
            }))
            : []
          setRestaurants(normalized)
        }
      } catch (err) {
        debugError("Error fetching restaurants:", err)
      }
    }

    fetchRestaurants()
  }, [])

  const todayYMD = () => {
    const d = new Date()
    const m = String(d.getMonth() + 1).padStart(2, "0")
    const day = String(d.getDate()).padStart(2, "0")
    return `${d.getFullYear()}-${m}-${day}`
  }

  const getFormDataFromOffer = (offer) => {
    const extractId = (item) => {
      if (!item) return ""
      if (typeof item === "object") return String(item._id || item.id || item.restaurantId || "")
      const s = String(item).trim()
      return s === "[object Object]" ? "" : s
    }

    let parsedRestaurantIds = []
    setEditingTargetedUsers(Array.isArray(offer?.targetedUsers) ? offer.targetedUsers : [])
    if (Array.isArray(offer?.restaurantIds) && offer.restaurantIds.length > 0) {
      parsedRestaurantIds = offer.restaurantIds.map(extractId).filter(Boolean)
    } else if (offer?.restaurantId) {
      const id = extractId(offer.restaurantId)
      if (id) parsedRestaurantIds = [id]
    }

    return {
      couponCode: String(offer?.couponCode || ""),
      discountType: offer?.discountType || "percentage",
      discountValue: String(
        Number(
          offer?.discountValue ??
          (offer?.discountType === "flat-price"
            ? (offer?.originalPrice ?? 0)
            : (offer?.discountPercentage ?? 0))
        )
      ),
      customerScope: offer?.customerScope || (offer?.customerGroup === "new" ? "first-time" : "all"),
      userIds: Array.isArray(offer?.userIds) ? offer.userIds.map(extractId).filter(Boolean) : [],
      restaurantScope: offer?.restaurantScope || (parsedRestaurantIds.length > 0 ? "selected" : "all"),
      restaurantIds: parsedRestaurantIds,
      endDate: offer?.endDate ? new Date(offer.endDate).toISOString().slice(0, 10) : "",
      startDate: offer?.startDate ? new Date(offer.startDate).toISOString().slice(0, 10) : "",
      minOrderValue: offer?.minOrderValue !== undefined && offer?.minOrderValue !== null ? String(offer.minOrderValue) : "",
      maxDiscount: offer?.maxDiscount !== undefined && offer?.maxDiscount !== null ? String(offer.maxDiscount) : "",
      usageLimit: offer?.usageLimit !== undefined && offer?.usageLimit !== null ? String(offer.usageLimit) : "",
      perUserLimit: offer?.perUserLimit !== undefined && offer?.perUserLimit !== null ? String(offer.perUserLimit) : "",
      isFirstOrderOnly: Boolean(offer?.isFirstOrderOnly || offer?.customerScope === "first-time"),
      adminBearPercentage: String(Number(offer?.adminBearPercentage ?? 100)),
      restaurantBearPercentage: String(Number(offer?.restaurantBearPercentage ?? 0)),
    }
  }
  const validateForm = (draft) => {
    const e = {}
    const f = draft || formData
    const pct = f.discountType === "percentage"
    const value = Number(f.discountValue)
    if (!String(f.couponCode || "").trim()) e.couponCode = "Coupon code is required"
    if (!Number.isFinite(value) || value <= 0) e.discountValue = "Discount must be greater than 0"
    if (pct && (f.maxDiscount === "" || f.maxDiscount === null || f.maxDiscount === undefined)) {
      e.maxDiscount = "Max discount is required for percentage coupons"
    }
    if (f.minOrderValue !== "" && Number(f.minOrderValue) < 0) e.minOrderValue = "Min order cannot be negative"
    if (f.usageLimit !== "" && Number(f.usageLimit) < 1) e.usageLimit = "Usage limit must be at least 1"
    if (f.perUserLimit !== "" && Number(f.perUserLimit) < 1) e.perUserLimit = "Per user limit must be at least 1"
    const usageLimitVal = f.usageLimit !== "" ? Number(f.usageLimit) : null
    const perUserLimitVal = f.perUserLimit !== "" ? Number(f.perUserLimit) : null
    if (f.isFirstOrderOnly && perUserLimitVal !== null && perUserLimitVal > 1) {
      e.perUserLimit = "Per user limit cannot be more than 1 when first order only is selected"
    }
    if (usageLimitVal !== null && perUserLimitVal !== null && perUserLimitVal > usageLimitVal) {
      e.perUserLimit = "Per user limit cannot be greater than usage limit"
    }
    const adminBear = Number(f.adminBearPercentage)
    const restaurantBear = Number(f.restaurantBearPercentage)
    if (!Number.isFinite(adminBear) || adminBear < 0 || adminBear > 100) e.adminBearPercentage = "Enter 0 to 100"
    if (!Number.isFinite(restaurantBear) || restaurantBear < 0 || restaurantBear > 100) e.restaurantBearPercentage = "Enter 0 to 100"
    if (Number.isFinite(adminBear) && Number.isFinite(restaurantBear) && Math.round((adminBear + restaurantBear) * 100) / 100 !== 100) {
      e.adminBearPercentage = "Both shares must total 100%"
      e.restaurantBearPercentage = "Both shares must total 100%"
    }
    if (f.customerScope === "selected" && (!Array.isArray(f.userIds) || f.userIds.length === 0)) {
      e.userIds = "Select at least one customer"
    }
    if (f.restaurantScope === "selected" && (!Array.isArray(f.restaurantIds) || f.restaurantIds.length === 0)) {
      e.restaurantIds = "Select at least one restaurant"
    }
    const start = f.startDate ? new Date(`${f.startDate}T00:00:00`) : null
    const end = f.endDate ? new Date(`${f.endDate}T00:00:00`) : null
    const now = new Date()
    if (end && end < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
      e.endDate = "End date cannot be in the past"
    }
    if (start && end && start > end) {
      e.startDate = "Start date must be before end date"
      e.endDate = "End date must be after start date"
    }
    setErrors(e)
    return { valid: Object.keys(e).length === 0, e }
  }

  const handleFormChange = (field, rawValue) => {
    let value = rawValue
    if (field === "couponCode") {
      value = String(value || "").toUpperCase()
    }
    if (field === "customerScope") {
      setFormData((prev) => {
        const next = {
          ...prev,
          customerScope: value,
          isFirstOrderOnly: value === "first-time",
          perUserLimit: value === "first-time" ? "1" : prev.perUserLimit,
          // Drop the target list when the coupon stops being user-specific, so a
          // stale selection cannot be submitted with a different scope.
          userIds: value === "selected" ? prev.userIds : [],
        }
        validateForm(next)
        return next
      })
      if (submitError) setSubmitError("")
      if (submitSuccess) setSubmitSuccess("")
      return
    }
    if (field === "isFirstOrderOnly") {
      setFormData((prev) => {
        const next = {
          ...prev,
          isFirstOrderOnly: value,
          perUserLimit: value ? "1" : prev.perUserLimit,
        }
        validateForm(next)
        return next
      })
      if (submitError) setSubmitError("")
      if (submitSuccess) setSubmitSuccess("")
      return
    }
    if (field === "discountType") {
      // When switching to flat-price, clear and disable maxDiscount
      if (value === "flat-price") {
        setFormData((prev) => {
          const next = { ...prev, discountType: value, maxDiscount: "" }
          validateForm(next)
          return next
        })
        if (submitError) setSubmitError("")
        if (submitSuccess) setSubmitSuccess("")
        return
      }
    }
    if (field === "restaurantScope" && value === "all") {
      setFormData((prev) => {
        const next = { ...prev, restaurantScope: value, restaurantIds: [] }
        validateForm(next)
        return next
      })
      if (submitError) setSubmitError("")
      if (submitSuccess) setSubmitSuccess("")
      return
    }
    if (field === "adminBearPercentage" || field === "restaurantBearPercentage") {
      const numeric = Number(value)
      const next = { ...formData, [field]: value }
      if (Number.isFinite(numeric) && numeric >= 0 && numeric <= 100) {
        const counterpart = String(Math.round((100 - numeric) * 100) / 100)
        if (field === "adminBearPercentage") next.restaurantBearPercentage = counterpart
        if (field === "restaurantBearPercentage") next.adminBearPercentage = counterpart
      }
      setFormData(next)
      validateForm(next)
      if (submitError) setSubmitError("")
      if (submitSuccess) setSubmitSuccess("")
      return
    }
    const next = { ...formData, [field]: value }
    // Date constraints
    if (field === "startDate" && next.endDate) {
      // Ensure startDate <= endDate
      const s = next.startDate ? new Date(`${next.startDate}T00:00:00`) : null
      const e = new Date(`${next.endDate}T00:00:00`)
      if (s && s > e) {
        // keep but will show error
      }
    }
    if (field === "endDate" && next.startDate) {
      const s = new Date(`${next.startDate}T00:00:00`)
      const e = next.endDate ? new Date(`${next.endDate}T00:00:00`) : null
      if (e && e < s) {
        // keep but will show error
      }
    }
    setFormData(next)
    validateForm(next)
    if (submitError) {
      setSubmitError("")
    }
    if (submitSuccess) {
      setSubmitSuccess("")
    }
  }

  const resetForm = () => {
    setEditingOfferId(null)
    setFormData({
      couponCode: "",
      discountType: "percentage",
      discountValue: "",
      customerScope: "all",
      userIds: [],
      restaurantScope: "all",
      restaurantIds: [],
      endDate: "",
      startDate: "",
      minOrderValue: "",
      maxDiscount: "",
      usageLimit: "",
      perUserLimit: "",
      isFirstOrderOnly: false,
      adminBearPercentage: "100",
      restaurantBearPercentage: "0",
    })
  }

  const openUsageReport = async (offer) => {
    const offerId = offer?.offerId || offer?.id
    if (!offerId) return
    setUsageModal({ couponCode: offer.couponCode, users: [], summary: null, coupon: null })
    setUsageLoading(true)
    setUsageError("")
    try {
      const response = await adminAPI.getOfferUsage(offerId)
      const data = response?.data?.data || {}
      setUsageModal({
        couponCode: data?.coupon?.couponCode || offer.couponCode,
        users: Array.isArray(data.users) ? data.users : [],
        summary: data.summary || null,
        coupon: data.coupon || null,
      })
    } catch (err) {
      setUsageError(err?.response?.data?.message || "Failed to load coupon usage")
    } finally {
      setUsageLoading(false)
    }
  }

  const handleSubmitCoupon = async (e) => {
    e.preventDefault()
    setSubmitError("")
    setSubmitSuccess("")
    const { valid } = validateForm()
    if (!valid) {
      setSubmitError("Please fix the highlighted errors")
      return
    }

    if (!formData.couponCode.trim()) {
      setSubmitError("Coupon code is required")
      return
    }

    const parsedDiscountValue = Number(formData.discountValue)
    if (!Number.isFinite(parsedDiscountValue) || parsedDiscountValue <= 0) {
      setSubmitError("Discount value must be greater than 0")
      return
    }

    if (formData.customerScope === "selected" && formData.userIds.length === 0) {
      setSubmitError("Select at least one customer for a user-specific coupon")
      return
    }
    if (formData.restaurantScope === "selected" && formData.restaurantIds.length === 0) {
      setSubmitError("Please select at least one restaurant")
      return
    }

    const payload = {
      couponCode: formData.couponCode.trim(),
      discountType: formData.discountType,
      discountValue: parsedDiscountValue,
      customerScope: formData.customerScope,
      userIds: formData.customerScope === "selected" ? formData.userIds : undefined,
      restaurantScope: formData.restaurantScope,
      restaurantIds: formData.restaurantScope === "selected" ? formData.restaurantIds : undefined,
      endDate: formData.endDate || undefined,
      startDate: formData.startDate || undefined,
      minOrderValue: formData.minOrderValue !== "" ? Number(formData.minOrderValue) : undefined,
      maxDiscount: formData.discountType === "percentage" && formData.maxDiscount !== "" ? Number(formData.maxDiscount) : undefined,
      usageLimit: formData.usageLimit !== "" ? Number(formData.usageLimit) : undefined,
      perUserLimit: formData.perUserLimit !== "" ? Number(formData.perUserLimit) : undefined,
      isFirstOrderOnly: Boolean(formData.isFirstOrderOnly || formData.customerScope === "first-time"),
      adminBearPercentage: Number(formData.adminBearPercentage),
      restaurantBearPercentage: Number(formData.restaurantBearPercentage),
    }

    try {
      setIsSubmitting(true)
      if (editingOfferId) {
        await adminAPI.updateAdminOffer(editingOfferId, payload)
        setSubmitSuccess("Coupon updated successfully")
      } else {
        await adminAPI.createAdminOffer(payload)
        setSubmitSuccess("Coupon created successfully")
      }
      resetForm()
      await fetchOffers()
    } catch (err) {
      debugError(editingOfferId ? "Error updating coupon:" : "Error creating coupon:", err)
      setSubmitError(err?.response?.data?.message || (editingOfferId ? "Failed to update coupon" : "Failed to create coupon"))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleStartEdit = (offer) => {
    setEditingOfferId(String(offer.offerId || offer._id || ""))
    setFormData(getFormDataFromOffer(offer))
    setIsAddOpen(true)
    setErrors({})
    setSubmitError("")
    setSubmitSuccess("")
  }

  const handleToggleShowInCart = async (offerId, itemId, currentValue) => {
    const key = `${offerId}-${itemId}`
    try {
      setUpdatingCartVisibility((prev) => ({ ...prev, [key]: true }))
      const nextValue = !currentValue
      await adminAPI.updateAdminOfferCartVisibility(offerId, itemId, nextValue)
      setOffers((prev) =>
        prev.map((offer) =>
          offer.offerId === offerId && offer.dishId === itemId
            ? { ...offer, showInCart: nextValue }
            : offer,
        ),
      )
    } catch (err) {
      debugError("Error updating cart visibility:", err)
    } finally {
      setUpdatingCartVisibility((prev) => ({ ...prev, [key]: false }))
    }
  }

  const handleDeleteOffer = async (offerId) => {
    if (!offerId) return
    if (deletingOffer[offerId]) return
    try {
      setDeletingOffer((prev) => ({ ...prev, [offerId]: true }))
      await adminAPI.deleteAdminOffer(offerId)
      setOffers((prev) => prev.filter((o) => o.offerId !== offerId))
    } catch (err) {
      debugError("Error deleting offer:", err)
    } finally {
      setDeletingOffer((prev) => ({ ...prev, [offerId]: false }))
    }
  }

  // Filter offers based on search query
  const filteredOffers = useMemo(() => {
    if (!searchQuery.trim()) {
      return offers
    }
    
    const query = searchQuery.toLowerCase().trim()
    return offers.filter(offer =>
      offer.restaurantName?.toLowerCase().includes(query) ||
      offer.dishName?.toLowerCase().includes(query) ||
      offer.couponCode?.toLowerCase().includes(query)
    )
  }, [offers, searchQuery])

  // Reset page when query changes
  useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery])

  // Calculate paginated subset
  const totalPages = Math.ceil(filteredOffers.length / itemsPerPage) || 1

  const getPageNumbers = () => {
    const delta = 1
    const left = currentPage - delta
    const right = currentPage + delta + 1
    const range = []
    const rangeWithDots = []
    let l

    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= left && i < right)) {
        range.push(i)
      }
    }

    for (let i of range) {
      if (l) {
        if (i - l === 2) {
          rangeWithDots.push(l + 1)
        } else if (i - l !== 1) {
          rangeWithDots.push("...")
        }
      }
      rangeWithDots.push(i)
      l = i
    }

    return rangeWithDots
  }

  const paginatedOffers = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage
    return filteredOffers.slice(start, start + itemsPerPage)
  }, [filteredOffers, currentPage])

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between mb-4">
            <h1 className="text-2xl font-bold text-slate-900">Restaurant Offers & Coupons</h1>
            <button
              type="button"
              onClick={() => {
                setIsAddOpen((prev) => {
                  const next = !prev
                  if (!next) {
                    resetForm()
                    setErrors({})
                  }
                  return next
                })
                setSubmitError("")
                setSubmitSuccess("")
              }}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors"
            >
              {isAddOpen ? "Close" : "Add Coupon"}
            </button>
          </div>

          {isAddOpen && (
            <form
              onSubmit={handleSubmitCoupon}
              className="border border-slate-200 rounded-xl p-4 mb-5 bg-slate-50"
            >
              <h3 className="text-base font-semibold text-slate-900 mb-3">{editingOfferId ? "Edit Coupon" : "Create Coupon"}</h3>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Coupon Code</label>
                  <input
                    type="text"
                    value={formData.couponCode}
                    onChange={(e) => handleFormChange("couponCode", e.target.value)}
                    placeholder="e.g. NEWUSER50"
                    className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Discount Type</label>
                  <StyledSelect
                    value={formData.discountType}
                    onChange={(value) => handleFormChange("discountType", value)}
                    ariaLabel="Discount type"
                    options={[
                      { value: "percentage", label: "Percentage" },
                      { value: "flat-price", label: "Flat Amount" },
                    ]}
                  />
                </div>

                <div title={formData.discountType === "flat-price" ? "Max discount is not applicable for flat coupons" : ""}>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    {formData.discountType === "percentage" ? "Discount (%)" : "Discount Amount"}
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    value={formData.discountValue}
                    onChange={(e) => handleFormChange("discountValue", e.target.value)}
                    placeholder={formData.discountType === "percentage" ? "e.g. 20" : "e.g. 100"}
                    className={`w-full px-3 py-2.5 text-sm rounded-lg border ${errors.discountValue ? "border-red-500" : "border-slate-300"} bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500`}
                  />
                  {errors.discountValue && <p className="mt-1 text-xs text-red-600">{errors.discountValue}</p>}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Customer Scope</label>
                  <StyledSelect
                    value={formData.customerScope}
                    onChange={(value) => handleFormChange("customerScope", value)}
                    ariaLabel="Customer scope"
                    options={[
                      { value: "all", label: "All Users" },
                      { value: "first-time", label: "First-time Users" },
                      { value: "selected", label: "Specific Customers" },
                    ]}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Restaurant Scope</label>
                  <StyledSelect
                    value={formData.restaurantScope}
                    onChange={(value) => handleFormChange("restaurantScope", value)}
                    ariaLabel="Restaurant scope"
                    options={[
                      { value: "all", label: "All Restaurants" },
                      { value: "selected", label: "Selected Restaurants" },
                    ]}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Expiry Date (Optional)</label>
                  <input
                    type="date"
                    value={formData.endDate}
                    onChange={(e) => handleFormChange("endDate", e.target.value)}
                  min={formData.startDate || todayYMD()}
                  className={`w-full px-3 py-2.5 text-sm rounded-lg border ${errors.endDate ? "border-red-500" : "border-slate-300"} bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500`}
                  />
                {errors.endDate && <p className="mt-1 text-xs text-red-600">{errors.endDate}</p>}
                </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Start Date (Optional)</label>
                <input
                  type="date"
                  value={formData.startDate}
                  onChange={(e) => handleFormChange("startDate", e.target.value)}
                  min={todayYMD()}
                  className={`w-full px-3 py-2.5 text-sm rounded-lg border ${errors.startDate ? "border-red-500" : "border-slate-300"} bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500`}
                />
                {errors.startDate && <p className="mt-1 text-xs text-red-600">{errors.startDate}</p>}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Min Order Value (Rs.)</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={formData.minOrderValue}
                  onChange={(e) => handleFormChange("minOrderValue", e.target.value)}
                  placeholder="e.g. 199"
                  className={`w-full px-3 py-2.5 text-sm rounded-lg border ${errors.minOrderValue ? "border-red-500" : "border-slate-300"} bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500`}
                />
                {errors.minOrderValue && <p className="mt-1 text-xs text-red-600">{errors.minOrderValue}</p>}
              </div>

                <div title={formData.discountType === "flat-price" ? "Max discount is not applicable for flat coupons" : ""}>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Max Discount (Rs., optional)</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                    value={formData.maxDiscount}
                    onChange={(e) => handleFormChange("maxDiscount", e.target.value)}
                  placeholder="e.g. 100"
                    disabled={formData.discountType === "flat-price"}
                    className={`w-full px-3 py-2.5 text-sm rounded-lg border ${errors.maxDiscount ? "border-red-500" : "border-slate-300"} bg-white disabled:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500`}
                />
                  {formData.discountType === "percentage" && errors.maxDiscount && <p className="mt-1 text-xs text-red-600">{errors.maxDiscount}</p>}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Admin Bear (%)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={formData.adminBearPercentage}
                  onChange={(e) => handleFormChange("adminBearPercentage", e.target.value)}
                  placeholder="e.g. 70"
                  className={`w-full px-3 py-2.5 text-sm rounded-lg border ${errors.adminBearPercentage ? "border-red-500" : "border-slate-300"} bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500`}
                />
                {errors.adminBearPercentage && <p className="mt-1 text-xs text-red-600">{errors.adminBearPercentage}</p>}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Restaurant Bear (%)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={formData.restaurantBearPercentage}
                  onChange={(e) => handleFormChange("restaurantBearPercentage", e.target.value)}
                  placeholder="e.g. 30"
                  className={`w-full px-3 py-2.5 text-sm rounded-lg border ${errors.restaurantBearPercentage ? "border-red-500" : "border-slate-300"} bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500`}
                />
                {errors.restaurantBearPercentage && <p className="mt-1 text-xs text-red-600">{errors.restaurantBearPercentage}</p>}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Usage Limit (global)</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={formData.usageLimit}
                  onChange={(e) => handleFormChange("usageLimit", e.target.value)}
                  placeholder="e.g. 1000"
                  className={`w-full px-3 py-2.5 text-sm rounded-lg border ${errors.usageLimit ? "border-red-500" : "border-slate-300"} bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500`}
                />
                {errors.usageLimit && <p className="mt-1 text-xs text-red-600">{errors.usageLimit}</p>}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Per User Limit</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={formData.customerScope === "first-time" ? "1" : formData.perUserLimit}
                  onChange={(e) => handleFormChange("perUserLimit", e.target.value)}
                  placeholder="e.g. 1"
                  disabled={formData.customerScope === "first-time"}
                  className={`w-full px-3 py-2.5 text-sm rounded-lg border ${errors.perUserLimit ? "border-red-500" : "border-slate-300"} bg-white disabled:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500`}
                />
                {errors.perUserLimit && <p className="mt-1 text-xs text-red-600">{errors.perUserLimit}</p>}
              </div>

                {formData.customerScope === "selected" && (
                  <div className="md:col-span-2 lg:col-span-3">
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Select Customers</label>
                    <CustomerMultiSelect
                      value={formData.userIds}
                      selectedDetails={editingTargetedUsers}
                      onChange={(userIds) => handleFormChange("userIds", userIds)}
                      error={errors.userIds}
                    />
                    {errors.userIds && <p className="mt-1 text-xs text-red-600">{errors.userIds}</p>}
                    <p className="mt-1 text-xs text-slate-500">
                      Only these customers will see and be able to redeem this coupon.
                    </p>
                  </div>
                )}

                {formData.restaurantScope === "selected" && (
                  <div className="md:col-span-2 lg:col-span-3">
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Select Restaurants</label>
                    <RestaurantMultiSelect
                      restaurants={restaurants}
                      value={formData.restaurantIds}
                      onChange={(restaurantIds) => handleFormChange("restaurantIds", restaurantIds)}
                      error={errors.restaurantIds}
                    />
                    {errors.restaurantIds && <p className="mt-1 text-xs text-red-600">{errors.restaurantIds}</p>}
                  </div>
                )}
              </div>

              {(submitError || submitSuccess) && (
                <div className={`mt-3 text-sm font-medium ${submitError ? "text-red-600" : "text-green-600"}`}>
                  {submitError || submitSuccess}
                </div>
              )}

              <div className="mt-4">
                <button
                  type="submit"
                  disabled={isSubmitting || Object.keys(errors).length > 0}
                  className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                  {isSubmitting ? (editingOfferId ? "Updating..." : "Creating...") : (editingOfferId ? "Update Coupon" : "Create Coupon")}
                </button>
              </div>
            </form>
          )}

          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              placeholder="Search by restaurant name, dish name, or coupon code..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>

        {/* Offers List */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-slate-900">
              Offers List
            </h2>
            <span className="px-3 py-1 rounded-full text-sm font-semibold bg-slate-100 text-slate-700">
              {filteredOffers.length} {filteredOffers.length === 1 ? 'offer' : 'offers'}
            </span>
          </div>

          {loading ? (
            <div className="text-center py-20">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <p className="text-sm text-slate-500 mt-4">Loading offers...</p>
            </div>
          ) : error ? (
            <div className="text-center py-20">
              <p className="text-lg font-semibold text-red-600 mb-1">Error</p>
              <p className="text-sm text-slate-500">{error}</p>
            </div>
          ) : filteredOffers.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-lg font-semibold text-slate-700 mb-1">No Offers Found</p>
              <p className="text-sm text-slate-500">
                {searchQuery ? "No offers match your search criteria" : "No offers have been created yet"}
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap">SI</th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap">Restaurant</th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap">Dish</th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap">Coupon Code</th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap">Customer Scope</th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap">Discount</th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap">Bear Split</th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap">Price</th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap">Min Order</th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap">Usage</th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap">Status</th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap">Show In Cart</th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap">Valid Until</th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-100">
                  {paginatedOffers.map((offer) => (
                    <tr key={`${offer.offerId}-${offer.dishId}`} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm font-medium text-slate-700">{offer.sl}</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm font-medium text-slate-900">
                          {offer.restaurantScope === "all" || offer.restaurantName === "All Restaurants" ? "All Restaurants" : offer.restaurantName}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
                          {offer.dishName}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm font-mono font-semibold text-blue-600 bg-blue-50 px-2 py-1 rounded whitespace-nowrap">
                          {offer.couponCode}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          offer.customerGroup === "new"
                            ? "bg-purple-100 text-purple-700"
                            : offer.customerGroup === "specific"
                              ? "bg-amber-100 text-amber-700"
                              : "bg-slate-100 text-slate-700"
                        }`}>
                          {offer.customerGroup === "new"
                            ? "First-time Users"
                            : offer.customerGroup === "specific"
                              ? `${offer.targetedUserCount || 0} Specific Customer${offer.targetedUserCount === 1 ? "" : "s"}`
                              : "All Users"}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm text-slate-700 whitespace-nowrap">
                          {offer.discountType === 'flat-price'
                            ? `\u20B9${offer.originalPrice - offer.discountedPrice} OFF`
                            : `${offer.discountPercentage}% OFF${Number(offer.maxDiscount) ? ` (up to \u20B9${Number(offer.maxDiscount)})` : ""}`}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-xs text-slate-700 leading-5">
                          <p>Admin: {Number(offer.adminBearPercentage ?? 100)}%</p>
                          <p>Restaurant: {Number(offer.restaurantBearPercentage ?? 0)}%</p>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm text-slate-700">
                          {offer.dishId === "all"
                            ? (Number(offer.minOrderValue) ? `Rs.${Number(offer.minOrderValue)}` : "-")
                            : (
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-slate-400 line-through">{"\u20B9"}{offer.originalPrice}</span>
                                <span className="text-sm font-semibold text-green-600">{"\u20B9"}{offer.discountedPrice}</span>
                              </div>
                            )}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm text-slate-700">
                          {Number(offer.minOrderValue) ? `Rs.${Number(offer.minOrderValue)}` : "-"}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm text-slate-700">
                          {`${Number(offer.usedCount || 0)} / ${Number(offer.usageLimit || 0) > 0 ? Number(offer.usageLimit) : "No limit"}`}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {(() => {
                          const expired = offer.validUntil && new Date(offer.validUntil) < new Date();
                          const status = expired ? 'expired' : (offer.status || 'inactive');
                          const cls =
                            status === 'active'
                              ? 'bg-green-100 text-green-700'
                              : status === 'paused'
                              ? 'bg-orange-100 text-orange-700'
                              : status === 'expired'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-gray-100 text-gray-700';
                          return (
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${cls}`}>
                              {status}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleToggleShowInCart(offer.offerId, offer.dishId, offer.showInCart !== false)}
                          disabled={!!updatingCartVisibility[`${offer.offerId}-${offer.dishId}`]}
                          className={`relative inline-flex h-6 w-12 items-center rounded-full transition-colors ${
                            offer.showInCart !== false ? "bg-green-600" : "bg-slate-300"
                          } disabled:opacity-60`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                              offer.showInCart !== false ? "translate-x-7" : "translate-x-1"
                            }`}
                          />
                        </button>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm text-slate-700 whitespace-nowrap">
                          {offer.endDate
                            ? (() => {
                                const d = new Date(offer.endDate)
                                const dd = String(d.getDate()).padStart(2, '0')
                                const month = d.toLocaleString('en-US', { month: 'short' })
                                const yyyy = d.getFullYear()
                                return `${dd} ${month} ${yyyy}`
                              })()
                            : 'No expiry'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleStartEdit(offer)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => openUsageReport(offer)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            title="See which customers used this coupon"
                          >
                            <Users className="h-3.5 w-3.5" />
                            Usage
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteOffer(offer.offerId)}
                            disabled={!!deletingOffer[offer.offerId]}
                            className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 disabled:opacity-60"
                          >
                            {deletingOffer[offer.offerId] ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {filteredOffers.length > 0 && (
              <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-slate-200 pt-6">
                <p className="text-sm text-slate-600 font-medium">
                  Showing{" "}
                  <span className="font-semibold text-slate-900">
                    {Math.min(filteredOffers.length, (currentPage - 1) * itemsPerPage + 1)}
                  </span>{" "}
                  to{" "}
                  <span className="font-semibold text-slate-900">
                    {Math.min(filteredOffers.length, currentPage * itemsPerPage)}
                  </span>{" "}
                  of{" "}
                  <span className="font-semibold text-slate-900">
                    {filteredOffers.length}
                  </span>{" "}
                  offers
                </p>
                
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Previous
                  </button>
                  
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {getPageNumbers().map((page, idx) =>
                      page === "..." ? (
                        <span key={`dots-${idx}`} className="px-2 py-1 text-sm font-bold text-slate-400">
                          ...
                        </span>
                      ) : (
                        <button
                          key={page}
                          type="button"
                          onClick={() => setCurrentPage(page)}
                          className={`min-w-9 h-9 flex items-center justify-center rounded-lg text-sm font-semibold transition-colors ${
                            currentPage === page
                              ? "bg-blue-600 text-white shadow-sm"
                              : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                          }`}
                        >
                          {page}
                        </button>
                      )
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
        </div>
      </div>

      {usageModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setUsageModal(null)}>
          <div
            className="max-h-[85vh] w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Coupon usage - <span className="font-mono text-blue-600">{usageModal.couponCode}</span>
                </h3>
                {usageModal.coupon && (
                  <p className="mt-0.5 text-xs text-slate-500">
                    {usageModal.coupon.customerScope === "selected"
                      ? `Targeted at ${usageModal.coupon.targetedUserCount} customer${usageModal.coupon.targetedUserCount === 1 ? "" : "s"}`
                      : usageModal.coupon.customerScope === "first-time"
                        ? "Available to first-time customers"
                        : "Available to all customers"}
                    {usageModal.coupon.usageLimit ? ` | Limit ${usageModal.coupon.usedCount}/${usageModal.coupon.usageLimit}` : ""}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setUsageModal(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {usageModal.summary && (
              <div className="grid grid-cols-2 gap-3 border-b border-slate-100 px-6 py-4 sm:grid-cols-4">
                {[
                  { label: "Customers", value: usageModal.summary.uniqueUsers },
                  { label: "Orders", value: usageModal.summary.totalOrders },
                  { label: "Discount given", value: `Rs. ${Math.round(usageModal.summary.totalDiscount)}` },
                  { label: "Order value", value: `Rs. ${Math.round(usageModal.summary.totalOrderValue)}` },
                ].map((stat) => (
                  <div key={stat.label} className="rounded-xl bg-slate-50 px-3 py-2.5">
                    <p className="text-xs font-medium text-slate-500">{stat.label}</p>
                    <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">{stat.value}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="max-h-[50vh] overflow-y-auto">
              {usageLoading && <p className="px-6 py-10 text-center text-sm text-slate-500">Loading usage...</p>}
              {usageError && <p className="px-6 py-10 text-center text-sm text-red-600">{usageError}</p>}
              {!usageLoading && !usageError && usageModal.users.length === 0 && (
                <p className="px-6 py-10 text-center text-sm text-slate-500">No one has used this coupon yet.</p>
              )}
              {!usageLoading && !usageError && usageModal.users.length > 0 && (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <th className="px-6 py-2.5">Customer</th>
                      <th className="px-6 py-2.5 text-right">Orders</th>
                      <th className="px-6 py-2.5 text-right">Discount</th>
                      <th className="px-6 py-2.5">Last used</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {usageModal.users.map((user) => (
                      <tr key={user.userId} className={user.orderCount === 0 ? "bg-slate-50/60" : ""}>
                        <td className="px-6 py-3">
                          <p className="font-medium text-slate-900">{user.name || "Unnamed customer"}</p>
                          <p className="text-xs text-slate-500">
                            {[user.phone, user.email].filter(Boolean).join(" | ") || "No contact on file"}
                          </p>
                          {user.isTargeted && (
                            <span className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                              Targeted
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-3 text-right font-semibold tabular-nums text-slate-900">
                          {user.orderCount}
                        </td>
                        <td className="px-6 py-3 text-right tabular-nums text-slate-700">
                          Rs. {Math.round(user.totalDiscount)}
                        </td>
                        <td className="px-6 py-3 text-slate-600">
                          {user.lastUsedAt ? new Date(user.lastUsedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "Not used yet"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}



