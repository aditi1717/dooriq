import { useMemo, useState, useEffect, useCallback } from "react"
import { BarChart3, ChevronDown, Settings, FileText, FileSpreadsheet, Code, Loader2 } from "lucide-react"
import { adminAPI } from "@food/api"
import { toast } from "sonner"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@food/components/ui/dropdown-menu"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@food/components/ui/dialog"
import { exportReportsToCSV, exportReportsToExcel, exportReportsToPDF, exportReportsToJSON } from "@food/components/admin/reports/reportsExportUtils"
import searchIcon from "@food/assets/Dashboard-icons/image8.png"
import exportIcon from "@food/assets/Dashboard-icons/image9.png"
import scheduledIcon from "@food/assets/Dashboard-icons/image24.png"
import pendingIcon from "@food/assets/Dashboard-icons/image25.png"
import acceptedIcon from "@food/assets/Dashboard-icons/image26.png"
import processingIcon from "@food/assets/Dashboard-icons/image27.png"
// Reuse existing icons since image28+ do not exist in assets
import onTheWayIcon from "@food/assets/Dashboard-icons/image24.png"
import deliveredIcon from "@food/assets/Dashboard-icons/image25.png"
import canceledIcon from "@food/assets/Dashboard-icons/image26.png"
import paymentFailedIcon from "@food/assets/Dashboard-icons/image27.png"
import refundedIcon from "@food/assets/Dashboard-icons/image25.png"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}


const statusMeta = {
  Scheduled: { label: "Scheduled Orders", color: "text-amber-600", bg: "bg-amber-50", icon: scheduledIcon },
  Pending: { label: "Pending Orders", color: "text-blue-600", bg: "bg-blue-50", icon: pendingIcon },
  Accepted: { label: "Accepted Orders", color: "text-sky-600", bg: "bg-sky-50", icon: acceptedIcon },
  Processing: { label: "Processing Orders", color: "text-indigo-600", bg: "bg-indigo-50", icon: processingIcon },
  "Food On The Way": { label: "Food On The Way", color: "text-cyan-600", bg: "bg-cyan-50", icon: onTheWayIcon },
  Delivered: { label: "Delivered", color: "text-emerald-600", bg: "bg-emerald-50", icon: deliveredIcon },
  Canceled: { label: "Canceled", color: "text-red-600", bg: "bg-red-50", icon: canceledIcon },
  "Payment Failed": { label: "Payment Failed", color: "text-orange-600", bg: "bg-orange-50", icon: paymentFailedIcon },
  Refunded: { label: "Refunded", color: "text-teal-600", bg: "bg-teal-50", icon: refundedIcon },
}

const PAGE_SIZE = 25

export default function RegularOrderReport() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [zones, setZones] = useState([])
  const [restaurants, setRestaurants] = useState([])
  const [customers, setCustomers] = useState([])
  const [offersList, setOffersList] = useState([])
  const [selectedOrderDetails, setSelectedOrderDetails] = useState(null)
  
  const [filters, setFilters] = useState({
    zone: "All Zones",
    restaurant: "All restaurants",
    customer: "All customers",
    time: "All Time",
  })
  const [searchQuery, setSearchQuery] = useState("")
  const [currentPage, setCurrentPage] = useState(1)

  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  // Fetch zones, restaurants, and customers for filter dropdowns
  useEffect(() => {
    const fetchFilterData = async () => {
      try {
        // Fetch zones
        const zonesRes = await adminAPI.getZones({ limit: 100, isActive: true })
        if (zonesRes.data?.success) {
          setZones(zonesRes.data.data.zones || [])
        }

        // Fetch restaurants
        const restaurantsRes = await adminAPI.getRestaurants({ limit: 100 })
        if (restaurantsRes.data?.success) {
          setRestaurants(restaurantsRes.data.data.restaurants || [])
        }

        // Fetch customers (users) via existing customers API
        const customersRes = await adminAPI.getCustomers({ limit: 100 })
        if (customersRes.data?.success) {
          setCustomers(customersRes.data.data.customers || [])
        }

        // Fetch offers to resolve bear percentages
        try {
          const offersRes = await adminAPI.getAllOffers({ limit: 1000 })
          if (offersRes.data?.success) {
            setOffersList(offersRes.data.data.offers || [])
          }
        } catch (offerErr) {
          debugError("Error fetching offers list:", offerErr)
        }
      } catch (err) {
        debugError("Error fetching filter data:", err)
      }
    }

    fetchFilterData()
  }, [])

  // Calculate date range based on time filter
  const getDateRange = () => {
    const now = new Date()
    let fromDate = null
    let toDate = null

    switch (filters.time) {
      case "Today":
        fromDate = new Date(now.setHours(0, 0, 0, 0))
        toDate = new Date(now.setHours(23, 59, 59, 999))
        break
      case "This Week":
        const weekStart = new Date(now)
        weekStart.setDate(now.getDate() - now.getDay())
        weekStart.setHours(0, 0, 0, 0)
        fromDate = weekStart
        toDate = new Date(now.setHours(23, 59, 59, 999))
        break
      case "This Month":
        fromDate = new Date(now.getFullYear(), now.getMonth(), 1)
        toDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
        break
      default:
        // All Time - no date filter
        break
    }

    return { fromDate, toDate }
  }

  // Fetch orders from backend
  const fetchOrders = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { fromDate, toDate } = getDateRange()
      const params = {
        page: 1,
        limit: 10000,
        ...(filters.zone !== "All Zones" && { zoneId: filters.zone }),
        ...(filters.restaurant !== "All restaurants" && { restaurantId: filters.restaurant }),
        ...(fromDate && { startDate: fromDate.toISOString().split('T')[0] }),
        ...(toDate && { endDate: toDate.toISOString().split('T')[0] }),
      }

      const response = await adminAPI.getOrders(params)

      if (response.data?.success) {
        // Transform backend orders (FoodOrder docs) to report format
        const rawOrders = response.data.data.orders || []
        const transformedOrders = rawOrders.map((order) => {
          const pricing = order.pricing || {}
          const items = Array.isArray(order.items) ? order.items : []

          const itemsSubtotal = items.reduce((sum, item) => {
            const qty = Number(item.quantity || 1)
            const price = Number(item.price || 0)
            return sum + qty * price
          }, 0)

          const subtotal =
            itemsSubtotal > 0
              ? itemsSubtotal
              : Number(pricing.subtotal || 0)

          const deliveryCharge = Number(pricing.deliveryFee || 0)
          const platformFee = Number(pricing.platformFee || 0)
          const vatTax = Number(pricing.tax || 0)
          const couponDiscount = Number(pricing.discount || 0)
          const computedTotal =
            subtotal + deliveryCharge + platformFee + vatTax - couponDiscount

          const totalAmount =
            pricing.total != null
              ? Number(pricing.total)
              : computedTotal

          const restaurantName =
            order.restaurantId?.restaurantName ||
            order.restaurantName ||
            ""
          const restaurantId =
            order.restaurantId?._id?.toString?.() ||
            order.restaurantId?.toString?.() ||
            ""
          const orderZoneId =
            order.restaurantId?.zoneId?._id?.toString?.() ||
            order.restaurantId?.zoneId?.toString?.() ||
            ""

          const customerName =
            order.userId?.name ||
            order.customerName ||
            "N/A"
          const customerId =
            order.userId?._id?.toString?.() ||
            order.userId?.toString?.() ||
            ""

          const backendStatus = String(order.orderStatus || "").toLowerCase()
          let displayStatus = order.orderStatus
          if (!backendStatus || backendStatus === "created" || backendStatus === "confirmed") {
            displayStatus = "Pending"
          } else if (backendStatus === "preparing" || backendStatus === "ready_for_pickup") {
            displayStatus = "Processing"
          } else if (backendStatus === "picked_up") {
            displayStatus = "Food On The Way"
          } else if (backendStatus === "delivered") {
            displayStatus = "Delivered"
          } else if (backendStatus === "cancelled_by_restaurant") {
            displayStatus = "Canceled"
          } else if (backendStatus === "cancelled_by_user" || backendStatus === "cancelled_by_admin") {
            displayStatus = "Canceled"
          }

          return {
            orderId: order.orderId,
            restaurantId,
            zoneId: orderZoneId,
            restaurant: restaurantName,
            customerId,
            customerName,
            totalItemAmount: subtotal,
            couponDiscount,
            vatTax,
            deliveryCharge,
            platformFee,
            totalAmount,
            orderStatus: displayStatus,
            restaurantCommission: Number(pricing.restaurantCommission || 0),
            couponCode: pricing.couponCode || null,
            rawOrder: order
          }
        })
        setOrders(transformedOrders)
      } else {
        setError(response.data?.message || "Failed to fetch orders")
        toast.error(response.data?.message || "Failed to fetch orders")
      }
    } catch (err) {
      debugError("Error fetching orders:", err)
      setError(err.response?.data?.message || "Failed to fetch orders")
      toast.error(err.response?.data?.message || "Failed to fetch orders")
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => {
    fetchOrders()
  }, [fetchOrders])

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      // Search is handled locally in filteredOrders, no need to refetch
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  const processedOrders = useMemo(() => {
    return orders.map(order => {
      const couponCode = order.couponCode ? String(order.couponCode).trim().toUpperCase() : ""
      const discount = Number(order.couponDiscount || 0)
      
      let adminBearPercentage = 100
      let restaurantBearPercentage = 0
      
      if (couponCode) {
        const foundOffer = offersList.find(o => String(o.couponCode || '').trim().toUpperCase() === couponCode)
        if (foundOffer) {
          adminBearPercentage = foundOffer.adminBearPercentage !== undefined ? Number(foundOffer.adminBearPercentage) : 100
          restaurantBearPercentage = foundOffer.restaurantBearPercentage !== undefined ? Number(foundOffer.restaurantBearPercentage) : 0
        }
      }
      
      const adminBearAmount = (discount * adminBearPercentage) / 100
      const restaurantBearAmount = (discount * restaurantBearPercentage) / 100
      
      return {
        ...order,
        adminBearPercentage,
        restaurantBearPercentage,
        adminBearAmount,
        restaurantBearAmount
      }
    })
  }, [orders, offersList])

  const filteredOrders = useMemo(() => {
    let scoped = processedOrders
    if (filters.zone !== "All Zones") {
      scoped = scoped.filter((o) => String(o.zoneId || "") === String(filters.zone))
    }
    if (filters.customer !== "All customers") {
      scoped = scoped.filter((o) => String(o.customerId || "") === String(filters.customer))
    }

    if (!searchQuery.trim()) return scoped
    const q = searchQuery.toLowerCase().trim()
    return scoped.filter((o) =>
      String(o.orderId || "")
        .toLowerCase()
        .includes(q),
    )
  }, [processedOrders, searchQuery, filters.zone, filters.customer])

  const handleExport = (format) => {
    if (filteredOrders.length === 0) {
      alert("No data to export")
      return
    }
    const headers = [
      { key: "orderId", label: "Order ID" },
      { key: "restaurant", label: "Restaurant" },
      { key: "customerName", label: "Customer Name" },
      { key: "totalItemAmount", label: "Total Item Amount" },
      { key: "couponCode", label: "Coupon Code" },
      { key: "couponDiscount", label: "Coupon Discount" },
      { key: "adminBearPercentage", label: "Admin Bear %" },
      { key: "adminBearAmount", label: "Admin Bear Amt" },
      { key: "restaurantBearPercentage", label: "Rest Bear %" },
      { key: "restaurantBearAmount", label: "Rest Bear Amt" },
      { key: "restaurantCommission", label: "Admin Commission" },
      { key: "vatTax", label: "VAT/Tax" },
      { key: "deliveryCharge", label: "Delivery Charge" },
      { key: "platformFee", label: "Platform Fee" },
      { key: "totalAmount", label: "Order Amount" },
      { key: "orderStatus", label: "Status" },
    ]
    switch (format) {
      case "csv": exportReportsToCSV(filteredOrders, headers, "regular_order_report"); break
      case "excel": exportReportsToExcel(filteredOrders, headers, "regular_order_report"); break
      case "pdf": exportReportsToPDF(filteredOrders, headers, "regular_order_report", "Regular Order Report"); break
      case "json": exportReportsToJSON(filteredOrders, "regular_order_report"); break
    }
  }

  const handleFilterApply = () => {
    // Filters are already applied via useMemo
  }

  const handleResetFilters = () => {
    setFilters({
      zone: "All Zones",
      restaurant: "All restaurants",
      customer: "All customers",
      time: "All Time",
    })
  }

  const activeFiltersCount = (filters.zone !== "All Zones" ? 1 : 0) + (filters.restaurant !== "All restaurants" ? 1 : 0) + (filters.customer !== "All customers" ? 1 : 0) + (filters.time !== "All Time" ? 1 : 0)

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE))

  const paginatedOrders = useMemo(() => {
    const safePage = Math.min(currentPage, totalPages)
    const start = (safePage - 1) * PAGE_SIZE
    return filteredOrders.slice(start, start + PAGE_SIZE)
  }, [filteredOrders, currentPage, totalPages])

  const statusCounts = useMemo(
    () =>
      filteredOrders.reduce(
        (acc, order) => {
          acc.total += 1
          if (acc[order.orderStatus] != null) acc[order.orderStatus] += 1
          return acc
        },
        {
          total: 0,
          Scheduled: 0,
          Pending: 0,
          Accepted: 0,
          Processing: 0,
          "Food On The Way": 0,
          Delivered: 0,
          Canceled: 0,
          "Payment Failed": 0,
          Refunded: 0,
        }
      ),
    [filteredOrders]
  )

  const formatAmount = (amount) =>
    `₹${Number(amount || 0).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
    setCurrentPage(1)
  }

  const handlePageChange = (newPage) => {
    if (newPage < 1 || newPage > totalPages) return
    setCurrentPage(newPage)
  }

  const renderStatusRow = (statusKey) => {
    const meta = statusMeta[statusKey]
    if (!meta) return null
    return (
      <div
        key={statusKey}
        className="flex items-center justify-between bg-white rounded-lg border border-slate-200 px-3 py-2 shadow-sm"
      >
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-lg ${meta.bg} flex items-center justify-center overflow-hidden`}>
            <img src={meta.icon} alt={meta.label} className="w-5 h-5 object-contain" />
          </div>
          <span className="text-[11px] font-medium text-slate-800">{meta.label}</span>
        </div>
          <span className={`text-xs font-semibold ${meta.color}`}>{statusCounts[statusKey] || 0}</span>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="p-2 lg:p-3 bg-slate-50 min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          <p className="text-gray-600">Loading orders...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-2 lg:p-3 bg-slate-50 min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-2">Error: {error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-2 lg:p-3 bg-slate-50 min-h-screen">
      <div className="w-full mx-auto">
        {/* Page Header */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3 mb-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
              <BarChart3 className="w-3.5 h-3.5 text-white" />
            </div>
            <h1 className="text-lg font-bold text-slate-900">Order Report</h1>
          </div>
        </div>

        {/* Search Data Filters */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3 mb-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <select
                value={filters.zone}
                onChange={(e) => handleFilterChange("zone", e.target.value)}
                className="w-full px-2.5 py-1.5 pr-5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs appearance-none cursor-pointer"
              >
                <option value="All Zones">All Zones</option>
                {zones.map((zone) => (
                  <option key={zone._id} value={zone._id}>
                    {zone.zoneName || zone.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
            </div>

            <div className="relative flex-1 min-w-0">
              <select
                value={filters.restaurant}
                onChange={(e) => handleFilterChange("restaurant", e.target.value)}
                className="w-full px-2.5 py-1.5 pr-5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs appearance-none cursor-pointer"
              >
                <option value="All restaurants">All restaurants</option>
                {restaurants.map((restaurant) => (
                  <option key={restaurant._id} value={restaurant._id}>
                    {restaurant.restaurantName || restaurant.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
            </div>

            <div className="relative flex-1 min-w-0">
              <select
                value={filters.customer}
                onChange={(e) => handleFilterChange("customer", e.target.value)}
                className="w-full px-2.5 py-1.5 pr-5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs appearance-none cursor-pointer"
              >
                <option value="All customers">All customers</option>
                {customers.map((customer) => (
                  <option key={customer._id} value={customer._id}>
                    {customer.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
            </div>

            <div className="relative flex-1 min-w-0">
              <select
                value={filters.time}
                onChange={(e) => handleFilterChange("time", e.target.value)}
                className="w-full px-2.5 py-1.5 pr-5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs appearance-none cursor-pointer"
              >
                <option key="all-time" value="All Time">All Time</option>
                <option key="today" value="Today">Today</option>
                <option key="this-week" value="This Week">This Week</option>
                <option key="this-month" value="This Month">This Month</option>
              </select>
              <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
            </div>

            <button 
              onClick={handleResetFilters}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-all whitespace-nowrap"
            >
              Reset
            </button>
            <button 
              onClick={handleFilterApply}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-all whitespace-nowrap relative ${
                activeFiltersCount > 0 ? "ring-2 ring-blue-300" : ""
              }`}
            >
              Filter
              {activeFiltersCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 text-white rounded-full text-[8px] flex items-center justify-center font-bold">
                  {activeFiltersCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Status Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 mb-3">
          {renderStatusRow("Scheduled")}
          {renderStatusRow("Pending")}
          {renderStatusRow("Processing")}
          {renderStatusRow("Food On The Way")}
          {renderStatusRow("Accepted")}
          {renderStatusRow("Delivered")}
          {renderStatusRow("Canceled")}
          {renderStatusRow("Payment Failed")}
          {renderStatusRow("Refunded")}
        </div>

        {/* Total Orders & Table */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
            <h2 className="text-base font-bold text-slate-900">
              Total Orders <span className="text-blue-600">{statusCounts.total}</span>
            </h2>

            <div className="flex items-center gap-2">
              <div className="relative flex-1 sm:flex-initial min-w-[180px]">
                <input
                  type="text"
                  placeholder="Search by Order ID"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value)
                    setCurrentPage(1)
                  }}
                  className="pl-7 pr-2 py-1.5 w-full text-[11px] rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <img src={searchIcon} alt="Search" className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3" />
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="px-2.5 py-1.5 text-[11px] font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 flex items-center gap-1 transition-all">
                    <img src={exportIcon} alt="Export" className="w-3 h-3" />
                    <span>Export</span>
                    <ChevronDown className="w-2.5 h-2.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 bg-white border border-slate-200 rounded-lg shadow-lg z-50 animate-in fade-in-0 zoom-in-95 duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95">
                  <DropdownMenuLabel>Export Format</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => handleExport("excel")} className="cursor-pointer">
                    <FileSpreadsheet className="w-4 h-4 mr-2" />
                    Export as Excel
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport("pdf")} className="cursor-pointer">
                    <FileText className="w-4 h-4 mr-2" />
                    Export as PDF
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <button 
                onClick={() => setIsSettingsOpen(true)}
                className="p-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 transition-all"
              >
                <Settings className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto scrollbar-hide">
            <table className="min-w-[1500px] w-full" style={{ tableLayout: "fixed" }}>
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-1.5 py-1 text-left text-[8px] font-bold text-slate-700 uppercase tracking-wider" style={{ width: "40px" }}>
                    SI
                  </th>
                  <th className="px-1.5 py-1 text-left text-[8px] font-bold text-slate-700 uppercase tracking-wider" style={{ width: "100px" }}>
                    Order Id
                  </th>
                  <th className="px-1.5 py-1 text-left text-[8px] font-bold text-slate-700 uppercase tracking-wider" style={{ width: "150px" }}>
                    Restaurant
                  </th>
                  <th className="px-1.5 py-1 text-left text-[8px] font-bold text-slate-700 uppercase tracking-wider" style={{ width: "120px" }}>
                    Customer Name
                  </th>
                  <th className="px-1.5 py-1 text-left text-[8px] font-bold text-slate-700 uppercase tracking-wider" style={{ width: "95px" }}>
                    Total Item Amt
                  </th>
                  <th className="px-1.5 py-1 text-left text-[8px] font-bold text-slate-700 uppercase tracking-wider" style={{ width: "80px" }}>
                    Coupon
                  </th>
                  <th className="px-1.5 py-1 text-left text-[8px] font-bold text-slate-700 uppercase tracking-wider" style={{ width: "95px" }}>
                    Coupon Disc
                  </th>
                  <th className="px-1.5 py-1 text-left text-[8px] font-bold text-slate-700 uppercase tracking-wider" style={{ width: "115px" }}>
                    Admin Bear
                  </th>
                  <th className="px-1.5 py-1 text-left text-[8px] font-bold text-slate-700 uppercase tracking-wider" style={{ width: "115px" }}>
                    Rest Bear
                  </th>
                  <th className="px-1.5 py-1 text-left text-[8px] font-bold text-slate-700 uppercase tracking-wider" style={{ width: "100px" }}>
                    Admin Comm
                  </th>
                  <th className="px-1.5 py-1 text-left text-[8px] font-bold text-slate-700 uppercase tracking-wider" style={{ width: "80px" }}>
                    Vat/Tax
                  </th>
                  <th className="px-1.5 py-1 text-left text-[8px] font-bold text-slate-700 uppercase tracking-wider" style={{ width: "95px" }}>
                    Delivery Charge
                  </th>
                  <th className="px-1.5 py-1 text-left text-[8px] font-bold text-slate-700 uppercase tracking-wider" style={{ width: "90px" }}>
                    Platform Fee
                  </th>
                  <th className="px-1.5 py-1 text-left text-[8px] font-bold text-slate-700 uppercase tracking-wider" style={{ width: "100px" }}>
                    Order Amount
                  </th>
                  <th className="px-1.5 py-1 text-left text-[8px] font-bold text-slate-700 uppercase tracking-wider" style={{ width: "85px" }}>
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100">
                {paginatedOrders.length === 0 ? (
                  <tr>
                    <td colSpan={15} className="px-6 py-20 text-center">
                      <div className="flex flex-col items-center justify-center">
                        <p className="text-lg font-semibold text-slate-700 mb-1">No Data Found</p>
                        <p className="text-sm text-slate-500">No orders match your filters</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  paginatedOrders.map((order, index) => (
                    <tr 
                      key={order.orderId} 
                      className="hover:bg-slate-50 transition-colors cursor-pointer"
                      onClick={() => setSelectedOrderDetails(order)}
                    >
                      <td className="px-1.5 py-1">
                        <span className="text-[10px] font-medium text-slate-700">
                          {(currentPage - 1) * PAGE_SIZE + index + 1}
                        </span>
                      </td>
                      <td className="px-1.5 py-1">
                        <span className="text-[10px] text-blue-600 hover:underline font-medium">{order.orderId}</span>
                      </td>
                      <td className="px-1.5 py-1">
                        <span className="text-[10px] text-slate-700 truncate block">{order.restaurant}</span>
                      </td>
                      <td className="px-1.5 py-1">
                        <span className="text-[10px] text-slate-700 truncate block">{order.customerName}</span>
                      </td>
                      <td className="px-1.5 py-1">
                        <span className="text-[10px] text-slate-700">{formatAmount(order.totalItemAmount)}</span>
                      </td>
                      <td className="px-1.5 py-1">
                        <span className="text-[10px] font-semibold text-slate-600 truncate block">{order.couponCode || "—"}</span>
                      </td>
                      <td className="px-1.5 py-1">
                        <span className="text-[10px] text-slate-700">{formatAmount(order.couponDiscount)}</span>
                      </td>
                      <td className="px-1.5 py-1">
                        <span className="text-[10px] text-slate-700">
                          {order.couponDiscount > 0 ? `${order.adminBearPercentage}% (${formatAmount(order.adminBearAmount)})` : "—"}
                        </span>
                      </td>
                      <td className="px-1.5 py-1">
                        <span className="text-[10px] text-slate-700">
                          {order.couponDiscount > 0 ? `${order.restaurantBearPercentage}% (${formatAmount(order.restaurantBearAmount)})` : "—"}
                        </span>
                      </td>
                      <td className="px-1.5 py-1">
                        <span className="text-[10px] text-emerald-600 font-medium">{formatAmount(order.restaurantCommission)}</span>
                      </td>
                      <td className="px-1.5 py-1">
                        <span className="text-[10px] text-slate-700">{formatAmount(order.vatTax)}</span>
                      </td>
                      <td className="px-1.5 py-1">
                        <span className="text-[10px] text-slate-700">{formatAmount(order.deliveryCharge)}</span>
                      </td>
                      <td className="px-1.5 py-1">
                        <span className="text-[10px] text-slate-700">{formatAmount(order.platformFee)}</span>
                      </td>
                      <td className="px-1.5 py-1">
                        <span className="text-[10px] font-bold text-slate-900">{formatAmount(order.totalAmount)}</span>
                      </td>
                      <td className="px-1.5 py-1">
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-slate-100 text-slate-700">
                          {order.orderStatus}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between mt-3">
            <p className="text-[10px] text-slate-500">
              Showing{" "}
              <span className="font-semibold text-slate-700">
                {paginatedOrders.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1} -{" "}
                {(currentPage - 1) * PAGE_SIZE + paginatedOrders.length}
              </span>{" "}
              of <span className="font-semibold text-slate-700">{filteredOrders.length}</span> orders
            </p>

            <div className="flex items-center gap-1">
              <button
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
                className="px-2 py-1 text-[10px] rounded border border-slate-300 text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50"
              >
                Prev
              </button>
              {Array.from({ length: totalPages }).map((_, idx) => (
                <button
                  key={idx + 1}
                  onClick={() => handlePageChange(idx + 1)}
                  className={`w-6 h-6 text-[10px] rounded border ${
                    currentPage === idx + 1
                      ? "bg-blue-600 border-blue-600 text-white"
                      : "border-slate-300 text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {idx + 1}
                </button>
              ))}
              <button
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="px-2 py-1 text-[10px] rounded border border-slate-300 text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Settings Dialog */}
      <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
        <DialogContent className="max-w-md bg-white p-0 opacity-0 data-[state=open]:opacity-100 data-[state=closed]:opacity-0 transition-opacity duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:scale-100 data-[state=closed]:scale-100">
          <DialogHeader className="px-6 pt-6 pb-4">
            <DialogTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5" />
              Report Settings
            </DialogTitle>
          </DialogHeader>
          <div className="px-6 pb-6">
            <p className="text-sm text-slate-700">
              Regular order report settings and preferences will be available here.
            </p>
          </div>
          <div className="px-6 pb-6 flex items-center justify-end">
            <button
              onClick={() => setIsSettingsOpen(false)}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-all shadow-md"
            >
              Close
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Order Details Dialog */}
      <Dialog open={Boolean(selectedOrderDetails)} onOpenChange={(open) => !open && setSelectedOrderDetails(null)}>
        <DialogContent className="max-w-3xl bg-white dark:bg-[#121212] p-0 overflow-y-auto max-h-[90vh] z-[100] border dark:border-gray-800 rounded-xl shadow-2xl">
          {selectedOrderDetails && (
            <>
              <DialogHeader className="px-6 pt-6 pb-4 border-b dark:border-gray-800 flex flex-row items-center justify-between">
                <div>
                  <DialogTitle className="text-lg font-bold">
                    Order Details: <span className="text-blue-600">{selectedOrderDetails.orderId}</span>
                  </DialogTitle>
                  <p className="text-xs text-gray-500 mt-1">
                    Placed on: {selectedOrderDetails.rawOrder?.createdAt ? new Date(selectedOrderDetails.rawOrder.createdAt).toLocaleString('en-IN') : "N/A"}
                  </p>
                </div>
              </DialogHeader>
              
              <div className="p-6 space-y-6">
                {/* Status and Zone */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
                    <span className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Status</span>
                    <p className="text-sm font-bold mt-1 text-slate-800 dark:text-slate-100">{selectedOrderDetails.orderStatus}</p>
                  </div>
                  <div className="p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
                    <span className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Restaurant</span>
                    <p className="text-sm font-bold mt-1 text-slate-800 dark:text-slate-100">{selectedOrderDetails.restaurant}</p>
                  </div>
                  <div className="p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
                    <span className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Customer</span>
                    <p className="text-sm font-bold mt-1 text-slate-800 dark:text-slate-100">{selectedOrderDetails.customerName}</p>
                  </div>
                </div>

                {/* Items Summary */}
                <div>
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Order Items</h3>
                  <div className="border rounded-lg overflow-hidden dark:border-gray-800">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-gray-50 dark:bg-gray-900 text-gray-500 font-bold border-b dark:border-gray-800">
                        <tr>
                          <th className="p-3">Item Name</th>
                          <th className="p-3">Price</th>
                          <th className="p-3 text-center">Qty</th>
                          <th className="p-3 text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y dark:divide-gray-800">
                        {(selectedOrderDetails.rawOrder?.items || []).map((item, idx) => (
                          <tr key={idx}>
                            <td className="p-3 font-medium">
                              {item.name}
                              {item.variantName && <span className="text-[10px] text-gray-500 ml-1">({item.variantName})</span>}
                            </td>
                            <td className="p-3">{formatAmount(item.price)}</td>
                            <td className="p-3 text-center">{item.quantity}</td>
                            <td className="p-3 text-right font-semibold">{formatAmount(Number(item.price) * Number(item.quantity))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Address & Delivery */}
                <div>
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Delivery Address</h3>
                  <div className="p-4 bg-gray-50 dark:bg-gray-900 rounded-lg space-y-2">
                    <p className="text-sm text-slate-800 dark:text-slate-200">
                      <strong className="text-xs text-gray-500 block">Recipient Full Name</strong>
                      {selectedOrderDetails.rawOrder?.deliveryAddress?.fullName || selectedOrderDetails.rawOrder?.customerName || "N/A"}
                    </p>
                    <p className="text-sm text-slate-800 dark:text-slate-200">
                      <strong className="text-xs text-gray-500 block">Phone</strong>
                      {selectedOrderDetails.rawOrder?.deliveryAddress?.phone || selectedOrderDetails.rawOrder?.customerPhone || "N/A"}
                    </p>
                    <p className="text-sm text-slate-800 dark:text-slate-200">
                      <strong className="text-xs text-gray-500 block">Street Address</strong>
                      {selectedOrderDetails.rawOrder?.deliveryAddress?.street || "N/A"}
                    </p>
                    <p className="text-sm text-slate-800 dark:text-slate-200">
                      <strong className="text-xs text-gray-500 block">Landmark / Additional Details</strong>
                      {selectedOrderDetails.rawOrder?.deliveryAddress?.additionalDetails || "N/A"}
                    </p>
                    {selectedOrderDetails.rawOrder?.deliveryAddress?.location?.coordinates && (
                      <p className="text-xs text-gray-500 mt-1">
                        🌐 Coordinates: [Lng: {selectedOrderDetails.rawOrder.deliveryAddress.location.coordinates[0]}, Lat: {selectedOrderDetails.rawOrder.deliveryAddress.location.coordinates[1]}]
                      </p>
                    )}
                  </div>
                </div>

                {/* Financials & Commission Breakdown */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Financials */}
                  <div>
                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Pricing Breakdown</h3>
                    <div className="p-4 border dark:border-gray-800 rounded-lg space-y-2 text-xs">
                      <div className="flex justify-between">
                        <span>Items Subtotal</span>
                        <span className="font-semibold">{formatAmount(selectedOrderDetails.totalItemAmount)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Delivery Charge</span>
                        <span>{formatAmount(selectedOrderDetails.deliveryCharge)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Platform Fee</span>
                        <span>{formatAmount(selectedOrderDetails.platformFee)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>GST / Tax</span>
                        <span>{formatAmount(selectedOrderDetails.vatTax)}</span>
                      </div>
                      {selectedOrderDetails.couponDiscount > 0 && (
                        <div className="flex justify-between text-red-600 font-medium">
                          <span>Coupon Discount ({selectedOrderDetails.couponCode || "Applied"})</span>
                          <span>-{formatAmount(selectedOrderDetails.couponDiscount)}</span>
                        </div>
                      )}
                      <div className="border-t dark:border-gray-800 pt-2 flex justify-between text-sm font-bold">
                        <span>Total Amount</span>
                        <span className="text-blue-600">{formatAmount(selectedOrderDetails.totalAmount)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Commission & Coupon Bear details */}
                  <div>
                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Admin Commission & Coupon Bear</h3>
                    <div className="p-4 border dark:border-gray-800 rounded-lg space-y-2 text-xs">
                      <div className="flex justify-between">
                        <span>Admin Commission Amount</span>
                        <span className="font-bold text-emerald-600">{formatAmount(selectedOrderDetails.restaurantCommission)}</span>
                      </div>
                      <div className="border-t dark:border-gray-800 my-2"></div>
                      <div className="flex justify-between">
                        <span>Applied Coupon</span>
                        <span className="font-semibold text-blue-600">{selectedOrderDetails.couponCode || "None"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Total Coupon Discount</span>
                        <span className="font-semibold">{formatAmount(selectedOrderDetails.couponDiscount)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Admin Bear %</span>
                        <span>{selectedOrderDetails.adminBearPercentage}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Admin Bear Amount</span>
                        <span className="font-medium">{formatAmount(selectedOrderDetails.adminBearAmount)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Restaurant Bear %</span>
                        <span>{selectedOrderDetails.restaurantBearPercentage}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Restaurant Bear Amount</span>
                        <span className="font-medium">{formatAmount(selectedOrderDetails.restaurantBearAmount)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Status History Timeline */}
                {selectedOrderDetails.rawOrder?.statusHistory?.length > 0 && (
                  <div>
                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Order Timeline</h3>
                    <div className="space-y-3 relative before:absolute before:inset-y-1 before:left-2 before:w-0.5 before:bg-gray-100 dark:before:bg-gray-800">
                      {selectedOrderDetails.rawOrder.statusHistory.map((history, idx) => (
                        <div key={idx} className="flex gap-4 items-start relative pl-6">
                          <div className="absolute left-1 top-1.5 w-2.5 h-2.5 rounded-full bg-blue-600 border-2 border-white dark:border-gray-900 z-10"></div>
                          <div className="flex-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-bold text-slate-800 dark:text-slate-200 capitalize">
                                Phase: {history.to}
                              </span>
                              <span className="text-[10px] text-gray-400">
                                {new Date(history.at).toLocaleString('en-IN')}
                              </span>
                            </div>
                            {history.note && (
                              <p className="text-[11px] text-gray-500 mt-0.5">Note: {history.note}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              
              <div className="px-6 pb-6 flex items-center justify-end border-t dark:border-gray-800 pt-4">
                <button
                  onClick={() => setSelectedOrderDetails(null)}
                  className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-300 hover:bg-slate-50 transition-all"
                >
                  Close Detail View
                </button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
