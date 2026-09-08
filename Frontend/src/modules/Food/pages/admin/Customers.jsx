import { useState, useMemo, useEffect } from "react"
import { useSearchParams } from "react-router-dom"
import { Search, Download, ChevronDown, Calendar, Eye, FileDown, FileSpreadsheet, FileText, X, Mail, Phone, MapPin, Package, IndianRupee, Calendar as CalendarIcon, User, CheckCircle, XCircle } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@food/components/ui/dropdown-menu"
import { exportCustomersToCSV, exportCustomersToExcel, exportCustomersToPDF } from "@food/components/admin/customers/customersExportUtils"
import { adminAPI } from "@food/api"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@food/components/ui/dialog"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}


export default function Customers() {
  const [searchQuery, setSearchQuery] = useState("")
  const [customers, setCustomers] = useState([])
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 10
  const [loading, setLoading] = useState(true)
  const [totalCustomers, setTotalCustomers] = useState(0)
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [userDetails, setUserDetails] = useState(null)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [showUserDetails, setShowUserDetails] = useState(false)
  const [walletEditing, setWalletEditing] = useState(false)
  const [walletSaving, setWalletSaving] = useState(false)
  const [walletForm, setWalletForm] = useState({
    razorpayWallet: "",
    referralWallet: "",
  })
  const [filters, setFilters] = useState({
    orderDate: "",
    joiningDate: "",
    status: "",
    sortBy: "",
    chooseFirst: "",
  })

  useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery, filters])

  const filteredCustomers = useMemo(() => {
    let result = [...customers]

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim()
      result = result.filter(customer =>
        customer.name.toLowerCase().includes(query) ||
        customer.email.toLowerCase().includes(query) ||
        customer.phone.includes(query)
      )
    }

    // Filter by order date when that field is available in the API payload.

    // Filter by joining date
    if (filters.joiningDate) {
      result = result.filter(customer => {
        // Parse joining date from format "17 Oct 2021"
        const customerDate = new Date(customer.joiningDate)
        const filterDate = new Date(filters.joiningDate)
        return customerDate.toDateString() === filterDate.toDateString()
      })
    }

    // Filter by status
    if (filters.status) {
      if (filters.status === "active") {
        result = result.filter(customer => customer.status === true)
      } else if (filters.status === "inactive") {
        result = result.filter(customer => customer.status === false)
      }
    }

    // Sort by options
    if (filters.sortBy) {
      if (filters.sortBy === "name-asc") {
        result.sort((a, b) => a.name.localeCompare(b.name))
      } else if (filters.sortBy === "name-desc") {
        result.sort((a, b) => b.name.localeCompare(a.name))
      } else if (filters.sortBy === "orders-asc") {
        result.sort((a, b) => a.totalOrder - b.totalOrder)
      } else if (filters.sortBy === "orders-desc") {
        result.sort((a, b) => b.totalOrder - a.totalOrder)
      }
    }

    // Limit results if "Choose First" is set
    if (filters.chooseFirst && parseInt(filters.chooseFirst) > 0) {
      result = result.slice(0, parseInt(filters.chooseFirst))
    }

    return result
  }, [customers, searchQuery, filters])

  const totalPages = Math.max(1, Math.ceil(filteredCustomers.length / itemsPerPage))

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

  const paginatedCustomers = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage
    return filteredCustomers.slice(startIndex, startIndex + itemsPerPage)
  }, [filteredCustomers, currentPage])

  const handleFilterChange = (field, value) => {
    setFilters(prev => ({ ...prev, [field]: value }))
  }

  const formatDateTime = (value) => {
    if (!value) return "-"
    try {
      const d = new Date(value)
      if (Number.isNaN(d.getTime())) return String(value)
      const day = String(d.getDate()).padStart(2, "0")
      const month = d.toLocaleString("en-GB", { month: "short" })
      const year = d.getFullYear()
      const time = d.toLocaleString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      })
      return `${day} ${month} ${year}, ${time}`
    } catch {
      return String(value)
    }
  }

  const formatCurrency = (value) =>
    `Rs. ${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const getWalletSummary = (source = {}) => {
    const wallet = source.wallet || {}
    const totalWallet = Number(wallet.totalWallet ?? source.walletBalance ?? wallet.balance ?? source.balance ?? 0) || 0
    const referralWallet = Number(wallet.referralWallet ?? wallet.referralEarnings ?? source.referralWallet ?? source.referralEarnings ?? 0) || 0
    const razorpayWallet = Math.max(0, totalWallet - referralWallet)
    return { razorpayWallet, referralWallet, totalWallet }
  }

  const syncWalletForm = (source = {}) => {
    const wallet = getWalletSummary(source)
    setWalletForm({
      razorpayWallet: String(wallet.razorpayWallet),
      referralWallet: String(wallet.referralWallet),
    })
  }

  // Fetch customers from API
  useEffect(() => {
    let cancelled = false
    const fetchCustomers = async () => {
      try {
        setLoading(true)
        const params = {
          limit: 1000,
          page: 1,
          ...(searchQuery && { search: searchQuery }),
          ...(filters.status && { status: filters.status }),
          ...(filters.joiningDate && { joiningDate: filters.joiningDate }),
          ...(filters.sortBy && { sortBy: filters.sortBy }),
          ...(filters.chooseFirst && { chooseFirst: filters.chooseFirst }),
        }

        const response = await adminAPI.getCustomers(params)
        const data = response?.data?.data || response?.data?.data || response?.data

        const list = data?.customers || data?.users || []
        if (!cancelled && Array.isArray(list)) {
          setCustomers(list)
          setTotalCustomers(data?.total || list.length)
        } else {
          if (!cancelled) {
            setCustomers([])
            setTotalCustomers(0)
          }
        }
      } catch (error) {
        debugError('Error fetching customers:', error)
        toast.error('Failed to load customers')
        if (!cancelled) {
          setCustomers([])
          setTotalCustomers(0)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    const t = setTimeout(fetchCustomers, 250)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [searchQuery, filters.status, filters.joiningDate, filters.sortBy, filters.chooseFirst])

  const [searchParams] = useSearchParams()
  const userIdFromUrl = searchParams.get("userId")

  useEffect(() => {
    if (userIdFromUrl && customers.length > 0) {
      const customer = customers.find(c => c.id === userIdFromUrl || c._id === userIdFromUrl)
      if (customer) {
        handleViewDetails(customer.id || customer.sl || customer._id)
      }
    }
  }, [userIdFromUrl, customers])

  const handleToggleStatus = async (customerId) => {
    try {
      // Find customer
      const customer = customers.find(c => (c._id || c.id) === customerId)
      if (!customer) return

      const newStatus = !customer.status

      // Optimistically update UI
      setCustomers(customers.map(c =>
        c.id === customerId ? { ...c, status: newStatus } : c
      ))

      // Call API to update user status
      await adminAPI.updateCustomerStatus(customerId, newStatus)
      toast.success(`User ${newStatus ? 'activated' : 'deactivated'} successfully`)
    } catch (error) {
      debugError('Error updating status:', error)
      toast.error('Failed to update status')
      // Revert optimistic update
      setCustomers(customers.map(c =>
        c.id === customerId ? { ...c, status: !c.status } : c
      ))
    }
  }

  const handleViewDetails = async (customerId) => {
    try {
      setLoadingDetails(true)
      setShowUserDetails(true)
      setSelectedCustomer(customerId)

      const response = await adminAPI.getCustomerById(customerId)
      const data = response?.data?.data || response?.data

      if (data?.user) {
        setUserDetails(data.user)
        syncWalletForm(data.user)
        setWalletEditing(false)
      } else {
        toast.error('Failed to load user details')
        setShowUserDetails(false)
      }
    } catch (error) {
      debugError('Error fetching user details:', error)
      toast.error('Failed to load user details')
      setShowUserDetails(false)
    } finally {
      setLoadingDetails(false)
    }
  }

  const handleSaveWallet = async () => {
    if (!userDetails?._id && !userDetails?.id) return
    const razorpayWallet = Number(walletForm.razorpayWallet)
    const referralWallet = Number(walletForm.referralWallet)

    if (!Number.isFinite(razorpayWallet) || razorpayWallet < 0) {
      toast.error("Enter a valid Razorpay wallet amount")
      return
    }
    if (!Number.isFinite(referralWallet) || referralWallet < 0) {
      toast.error("Enter a valid referral wallet amount")
      return
    }

    try {
      setWalletSaving(true)
      const customerId = userDetails._id || userDetails.id
      const response = await adminAPI.updateCustomerWallet(customerId, {
        razorpayWallet,
        referralWallet,
      })
      const wallet = response?.data?.data?.wallet || response?.data?.wallet
      const nextUserDetails = {
        ...userDetails,
        wallet,
        walletBalance: wallet?.totalWallet ?? (razorpayWallet + referralWallet),
        razorpayWallet: wallet?.razorpayWallet ?? razorpayWallet,
        referralWallet: wallet?.referralWallet ?? referralWallet,
      }
      setUserDetails(nextUserDetails)
      syncWalletForm(nextUserDetails)
      setCustomers(prev => prev.map(customer => {
        const id = String(customer._id || customer.id || customer.sl)
        if (id !== String(customerId)) return customer
        return {
          ...customer,
          wallet,
          walletBalance: wallet?.totalWallet ?? (razorpayWallet + referralWallet),
          razorpayWallet: wallet?.razorpayWallet ?? razorpayWallet,
          referralWallet: wallet?.referralWallet ?? referralWallet,
        }
      }))
      setWalletEditing(false)
      toast.success("Customer wallet updated")
    } catch (error) {
      debugError("Error updating customer wallet:", error)
      toast.error(error?.response?.data?.message || "Failed to update wallet")
    } finally {
      setWalletSaving(false)
    }
  }

  const handleToggleCodBlock = async () => {
    if (!userDetails?._id && !userDetails?.id) return
    const customerId = userDetails._id || userDetails.id
    const nextCodBlocked = !userDetails.isCodBlocked
    try {
      await adminAPI.updateCustomerCodBlock(customerId, nextCodBlocked)
      setUserDetails(prev => ({ ...prev, isCodBlocked: nextCodBlocked }))
      setCustomers(prev => prev.map(c => 
        (c.id === customerId || c._id === customerId) ? { ...c, isCodBlocked: nextCodBlocked } : c
      ))
      toast.success(`COD payment ${nextCodBlocked ? 'blocked' : 'enabled'} successfully`)
    } catch (error) {
      debugError('Error toggling COD block:', error)
      toast.error('Failed to update COD block status')
    }
  }

  const handleToggleCodBlockedRow = async (customerId, currentCodBlocked) => {
    const nextCodBlocked = !currentCodBlocked
    try {
      await adminAPI.updateCustomerCodBlock(customerId, nextCodBlocked)
      setCustomers(prev => prev.map(c => 
        (c.id === customerId || c._id === customerId) ? { ...c, isCodBlocked: nextCodBlocked } : c
      ))
      toast.success(`COD payment ${nextCodBlocked ? 'blocked' : 'enabled'} successfully`)
    } catch (error) {
      debugError('Error toggling COD block in row:', error)
      toast.error('Failed to update COD block status')
    }
  }

  const handleExport = (format) => {
    if (filteredCustomers.length === 0) {
      toast.error("No customers to export")
      return
    }

    const filename = "customers"
    try {
      switch (format) {
        case "csv":
          exportCustomersToCSV(filteredCustomers, filename)
          toast.success("CSV export started")
          break
        case "excel":
          exportCustomersToExcel(filteredCustomers, filename)
          toast.success("Excel export started")
          break
        case "pdf":
          exportCustomersToPDF(filteredCustomers, filename)
          toast.success("PDF download started")
          break
        default:
          toast.error("Invalid export format")
          break
      }
    } catch (error) {
      debugError("Export error:", error)
      toast.error("Failed to export customers")
    }
  }

  const getInitials = (name) => {
    if (!name) return "NA"
    return name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || "")
      .join("") || "NA"
  }

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-7xl mx-auto">
        {/* Filters Section */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Order Date
              </label>
              <div className="relative">
                <input
                  type="date"
                  max={new Date().toISOString().split("T")[0]}
                  value={filters.orderDate}
                  onChange={(e) => handleFilterChange("orderDate", e.target.value)}
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Customer Joining Date
              </label>
              <div className="relative">
                <input
                  type="date"
                  max={new Date().toISOString().split("T")[0]}
                  value={filters.joiningDate}
                  onChange={(e) => handleFilterChange("joiningDate", e.target.value)}
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Customer status
              </label>
              <select
                value={filters.status}
                onChange={(e) => handleFilterChange("status", e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
              >
                <option value="">Select Status</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Sort By
              </label>
              <select
                value={filters.sortBy}
                onChange={(e) => handleFilterChange("sortBy", e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
              >
                <option value="">Select Customer Sorting Order</option>
                <option value="name-asc">Name (A-Z)</option>
                <option value="name-desc">Name (Z-A)</option>
                <option value="orders-asc">Orders (Low to High)</option>
                <option value="orders-desc">Orders (High to Low)</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Choose First
              </label>
              <input
                type="number"
                value={filters.chooseFirst}
                onChange={(e) => handleFilterChange("chooseFirst", e.target.value)}
                placeholder="Ex: 100"
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
              />
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  setFilters({
                    orderDate: "",
                    joiningDate: "",
                    status: "",
                    sortBy: "",
                    chooseFirst: "",
                  })
                }}
                className="px-6 py-2.5 text-sm font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-all"
              >
                Reset Filters
              </button>
            </div>
            <div className="text-sm text-slate-600">
              {loading ? 'Loading...' : `Showing ${filteredCustomers.length} of ${totalCustomers} customers`}
            </div>
          </div>
        </div>

        {/* Customer List Section */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-slate-900">Customer list</h2>
              <span className="px-3 py-1 rounded-full text-sm font-semibold bg-slate-100 text-slate-700">
                {filteredCustomers.length}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <div className="relative flex-1 sm:flex-initial min-w-[200px]">
                <input
                  type="text"
                  placeholder="Search by name"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 pr-4 py-2.5 w-full text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-slate-400"
                />
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="px-4 py-2.5 text-sm font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 flex items-center gap-2 transition-all">
                    <Download className="w-4 h-4" />
                    <span className="text-black font-bold">Export</span>
                    <ChevronDown className="w-3 h-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 bg-white border border-slate-200 rounded-lg shadow-lg z-50">
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
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px]">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Sl</th>
                  <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Name</th>
                  <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Contact Information</th>
                  <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Total Order</th>
                  <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Total Order Amount</th>
                  <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Wallet Amount</th>
                  <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Joining Date</th>
                  <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">COD Status</th>
                  <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Active/Inactive</th>
                  <th className="px-6 py-4 text-center text-[10px] font-bold text-slate-700 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={10} className="px-6 py-8 text-center">
                      <div className="text-sm text-slate-500">Loading customers...</div>
                    </td>
                  </tr>
                ) : filteredCustomers.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-6 py-8 text-center">
                      <div className="text-sm text-slate-500">No customers found</div>
                    </td>
                  </tr>
                ) : (
                  paginatedCustomers.map((customer, index) => (
                    <tr key={customer.id || customer.sl} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm font-medium text-slate-700">{(currentPage - 1) * itemsPerPage + index + 1}</span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div 
                            className="w-10 h-10 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center shrink-0 overflow-hidden cursor-pointer hover:opacity-80 transition-all border border-slate-100"
                            onClick={() => handleViewDetails(customer._id || customer.id || customer.sl)}
                          >
                            {customer.profileImage ? (
                              <img
                                src={customer.profileImage}
                                alt={customer.name}
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  e.currentTarget.style.display = "none"
                                }}
                              />
                            ) : (
                              <span className="text-xs font-semibold">{getInitials(customer.name)}</span>
                            )}
                          </div>
                          <span 
                            className="text-sm font-medium text-slate-900 cursor-pointer hover:text-blue-600 transition-colors"
                            onClick={() => handleViewDetails(customer._id || customer.id || customer.sl)}
                          >
                            {customer.name}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="text-sm text-slate-700">{customer.email}</span>
                          <span className="text-xs text-slate-500">{customer.phone}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm text-slate-700">{customer.totalOrder || 0}</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm font-medium text-slate-900">Rs. {(customer.totalOrderAmount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex flex-col">
                          <span className="text-sm font-bold text-emerald-700">{formatCurrency(getWalletSummary(customer).totalWallet)}</span>
                          <span className="text-[11px] text-slate-500">Top-up {formatCurrency(getWalletSummary(customer).razorpayWallet)}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm text-slate-700">{formatDateTime(customer.joiningDate)}</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <button
                          onClick={() => handleToggleCodBlockedRow(customer._id || customer.id || customer.sl, customer.isCodBlocked)}
                          className={`px-2.5 py-1 rounded text-xs font-bold transition-colors ${
                            customer.isCodBlocked
                              ? "bg-red-100 text-red-700 hover:bg-red-200"
                              : "bg-green-100 text-green-700 hover:bg-green-200"
                          }`}
                        >
                          {customer.isCodBlocked ? "Blocked" : "Active"}
                        </button>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <button
                          onClick={() => handleToggleStatus(customer.id || customer.sl)}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${customer.status ? "bg-blue-600" : "bg-slate-300"
                            }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${customer.status ? "translate-x-6" : "translate-x-1"
                              }`}
                          />
                        </button>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center">
                        <button
                          onClick={() => handleViewDetails(customer._id || customer.id || customer.sl)}
                          className="p-1.5 rounded text-blue-600 hover:bg-blue-50 transition-colors"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {!loading && filteredCustomers.length > 0 && (
            <div className="border-t border-slate-200 bg-slate-50 px-5 py-4 mt-4 rounded-lg flex flex-col sm:flex-row items-center justify-between gap-4">
              <span className="text-sm font-semibold text-slate-500">
                Showing {Math.min(filteredCustomers.length, (currentPage - 1) * itemsPerPage + 1)} to {Math.min(filteredCustomers.length, currentPage * itemsPerPage)} of {filteredCustomers.length} customers
              </span>
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
        </div>
      </div>

      {/* User Details Modal */}
      <Dialog open={showUserDetails} onOpenChange={setShowUserDetails}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto mx-auto p-0 gap-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-slate-200">
            <DialogTitle className="pr-12 text-xl font-bold text-slate-900">User Details</DialogTitle>
          </DialogHeader>

          {loadingDetails ? (
            <div className="px-6 py-8 text-center">
              <div className="text-sm text-slate-500">Loading user details...</div>
            </div>
          ) : userDetails ? (
            <div className="space-y-4 px-6 py-5">
              {/* Profile Section */}
              <div className="bg-slate-50 rounded-xl p-4 sm:p-5">
                <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                  <div className="w-16 h-16 rounded-full bg-slate-200 flex items-center justify-center flex-shrink-0">
                    {userDetails.profileImage ? (
                      <img src={userDetails.profileImage} alt={userDetails.name} className="w-full h-full rounded-full object-cover" />
                    ) : (
                      <User className="w-8 h-8 text-slate-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <h3 className="text-lg font-bold text-slate-900">{userDetails.name}</h3>
                      {userDetails.isActive ? (
                        <span className="px-2 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700 flex items-center gap-1">
                          <CheckCircle className="w-3 h-3" />
                          Active
                        </span>
                      ) : (
                        <span className="px-2 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700 flex items-center gap-1">
                          <XCircle className="w-3 h-3" />
                          Inactive
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                      <div className="flex items-center gap-2 text-sm text-slate-600 min-w-0">
                        <Mail className="w-4 h-4" />
                        <span className="truncate">{userDetails.email}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-slate-600 min-w-0">
                        <Phone className="w-4 h-4" />
                        <span>{userDetails.phone}</span>
                        {userDetails.phoneVerified && (
                          <CheckCircle className="w-3 h-3 text-green-600" />
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-sm text-slate-600">
                        <CalendarIcon className="w-4 h-4" />
                        <span>Joined: {formatDateTime(userDetails.joiningDate)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Statistics Section */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="bg-blue-50 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Package className="w-4 h-4 text-blue-600" />
                    <span className="text-xs font-semibold text-slate-700">Total Orders</span>
                  </div>
                  <p className="text-xl font-bold text-blue-600">{userDetails.totalOrders || 0}</p>
                </div>
                <div className="bg-green-50 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <IndianRupee className="w-4 h-4 text-green-600" />
                    <span className="text-xs font-semibold text-slate-700">Total Spent</span>
                  </div>
                  <p className="text-xl font-bold text-green-600">
                    Rs. {(userDetails.totalOrderAmount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
                <div className="bg-purple-50 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <CalendarIcon className="w-4 h-4 text-purple-600" />
                    <span className="text-xs font-semibold text-slate-700">Member Since</span>
                  </div>
                  <p className="text-base font-bold text-purple-600">{formatDateTime(userDetails.joiningDate)}</p>
                </div>
              </div>

              {/* Wallet Section */}
              <div className="bg-emerald-50 rounded-xl p-4 sm:p-5 border border-emerald-100">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
                  <div>
                    <h4 className="text-base font-bold text-slate-900 flex items-center gap-2">
                      <IndianRupee className="w-4 h-4 text-emerald-700" />
                      Customer Wallet
                    </h4>
                    <p className="text-xs text-slate-600 mt-1">Split between Razorpay/top-up wallet and referral wallet.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {walletEditing ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            syncWalletForm(userDetails)
                            setWalletEditing(false)
                          }}
                          disabled={walletSaving}
                          className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-bold text-slate-700 disabled:opacity-60"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleSaveWallet}
                          disabled={walletSaving}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 text-xs font-bold text-white disabled:opacity-60"
                        >
                          {walletSaving ? "Saving..." : "Save"}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          syncWalletForm(userDetails)
                          setWalletEditing(true)
                        }}
                        className="px-3 py-1.5 rounded-lg bg-white border border-emerald-200 text-xs font-bold text-emerald-700"
                      >
                        Edit Wallet
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="bg-white rounded-lg p-3 border border-emerald-100">
                    <p className="text-xs font-semibold text-slate-600 mb-1">Total Wallet</p>
                    <p className="text-xl font-bold text-emerald-700">{formatCurrency(getWalletSummary(userDetails).totalWallet)}</p>
                  </div>

                  <div className="bg-white rounded-lg p-3 border border-emerald-100">
                    <p className="text-xs font-semibold text-slate-600 mb-1">Razorpay / Top-up Wallet</p>
                    {walletEditing ? (
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={walletForm.razorpayWallet}
                        onChange={(e) => setWalletForm(prev => ({ ...prev, razorpayWallet: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    ) : (
                      <p className="text-lg font-bold text-slate-900">{formatCurrency(getWalletSummary(userDetails).razorpayWallet)}</p>
                    )}
                  </div>

                  <div className="bg-white rounded-lg p-3 border border-emerald-100">
                    <p className="text-xs font-semibold text-slate-600 mb-1">Referral Wallet</p>
                    {walletEditing ? (
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={walletForm.referralWallet}
                        onChange={(e) => setWalletForm(prev => ({ ...prev, referralWallet: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    ) : (
                      <p className="text-lg font-bold text-slate-900">{formatCurrency(getWalletSummary(userDetails).referralWallet)}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Wallet Transaction History Section */}
              {userDetails.wallet && userDetails.wallet.transactions && userDetails.wallet.transactions.length > 0 && (
                <div>
                  <h4 className="text-base font-bold text-slate-900 mb-2 flex items-center gap-2">
                    <CalendarIcon className="w-4 h-4 text-emerald-700" />
                    Wallet Transaction History
                  </h4>
                  <div className="bg-slate-50 rounded-xl border border-slate-200 divide-y divide-slate-100 max-h-60 overflow-y-auto">
                    {userDetails.wallet.transactions.map((tx, idx) => {
                      const isAddition = tx.type === 'addition';
                      const isRefund = tx.type === 'refund';
                      return (
                        <div key={idx} className="p-3 flex items-center justify-between gap-3 text-sm">
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-800 truncate">{tx.description || (isAddition ? 'Funds Added' : 'Payment')}</p>
                            <p className="text-xs text-slate-500 mt-0.5">{formatDateTime(tx.createdAt || tx.date)}</p>
                          </div>
                          <div className="flex-shrink-0 text-right">
                            <p className={`font-bold ${isAddition ? 'text-green-600' : isRefund ? 'text-blue-600' : 'text-red-600'}`}>
                              {isAddition ? '+' : isRefund ? 'Refund: ' : '-'}{formatCurrency(tx.amount)}
                            </p>
                            <span className="text-[10px] bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded font-medium">
                              {tx.status || 'Completed'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* COD Control Section */}
              <div className="bg-slate-50 rounded-xl p-4 sm:p-5 border border-slate-200">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <h4 className="text-base font-bold text-slate-900 flex items-center gap-2">
                      <IndianRupee className="w-4 h-4 text-slate-700" />
                      Cash on Delivery (COD) Control
                    </h4>
                    <p className="text-xs text-slate-600 mt-1">Enable or disable Cash on Delivery payment for this specific user.</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleToggleCodBlock}
                    className={`px-4 py-2 rounded-lg font-bold text-xs sm:text-sm transition-all shadow-sm flex-shrink-0 ${
                      userDetails.isCodBlocked
                        ? "bg-red-600 hover:bg-red-700 text-white"
                        : "bg-green-600 hover:bg-green-700 text-white"
                    }`}
                  >
                    {userDetails.isCodBlocked ? "COD is BLOCKED (Click to Enable)" : "COD is ACTIVE (Click to Block)"}
                  </button>
                </div>
              </div>

              {/* Addresses Section */}
              {userDetails.addresses && userDetails.addresses.length > 0 && (
                <div>
                  <h4 className="text-base font-bold text-slate-900 mb-2 flex items-center gap-2">
                    <MapPin className="w-4 h-4" />
                    Addresses
                  </h4>
                  <div className="space-y-2">
                    {userDetails.addresses.map((address, index) => (
                      <div key={index} className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-semibold text-slate-700">{address.label || 'Address'}</span>
                          {address.isDefault && (
                            <span className="px-2 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">
                              Default
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-slate-600">
                          {address.street}
                          {address.additionalDetails && `, ${address.additionalDetails}`}
                          {address.city && `, ${address.city}`}
                          {address.state && `, ${address.state}`}
                          {address.zipCode && ` - ${address.zipCode}`}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recent Orders Section */}
              {userDetails.orders && userDetails.orders.length > 0 && (
                <div>
                  <h4 className="text-base font-bold text-slate-900 mb-2 flex items-center gap-2">
                    <Package className="w-4 h-4" />
                    Recent Orders
                  </h4>
                  <div className="space-y-2">
                    {userDetails.orders.slice(0, 5).map((order, index) => (
                      <div key={index} className="bg-slate-50 rounded-lg p-3 border border-slate-200 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{order.orderId}</p>
                          <p className="text-xs text-slate-600">{order.restaurantName}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold text-slate-900">Rs. {(order.total || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                          <p className="text-xs text-slate-600 capitalize">{order.status}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Additional Info */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {userDetails.gender && (
                  <div className="bg-slate-50 rounded-lg p-3">
                    <p className="text-xs font-semibold text-slate-700 mb-1">Gender</p>
                    <p className="text-sm text-slate-600 capitalize">{userDetails.gender}</p>
                  </div>
                )}
                {userDetails.dateOfBirth && (
                  <div className="bg-slate-50 rounded-lg p-3">
                    <p className="text-xs font-semibold text-slate-700 mb-1">Date of Birth</p>
                    <p className="text-sm text-slate-600">
                      {new Date(userDetails.dateOfBirth).toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric'
                      })}
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="py-8 text-center">
              <div className="text-sm text-slate-500">No user details available</div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
