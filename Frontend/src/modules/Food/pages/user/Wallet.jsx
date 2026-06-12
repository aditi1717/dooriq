import { useState, useMemo, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeft, IndianRupee, Plus, ArrowDownCircle, ArrowUpCircle, RefreshCw, Loader2, XCircle } from "lucide-react"
import { Button } from "@food/components/ui/button"
import { Card, CardContent } from "@food/components/ui/card"
import AnimatedPage from "@food/components/user/AnimatedPage"
import AddMoneyModal from "@food/components/user/AddMoneyModal"
import RedeemCoinsModal from "@food/components/user/RedeemCoinsModal"
import { userAPI } from "@food/api"
import { toast } from "sonner"
import { useCompanyName } from "@food/hooks/useCompanyName"
import useAppBackNavigation from "@food/hooks/useAppBackNavigation"

const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}

const TRANSACTION_TYPES = {
  ALL: "all",
  ADDITIONS: "additions",
  DEDUCTIONS: "deductions",
  REFUNDS: "refunds",
}

export default function Wallet() {
  const companyName = useCompanyName()
  const navigate = useNavigate()
  const goBack = useAppBackNavigation()
  const [selectedFilter, setSelectedFilter] = useState(TRANSACTION_TYPES.ALL)
  const [wallet, setWallet] = useState(null)
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [addMoneyModalOpen, setAddMoneyModalOpen] = useState(false)
  const [redeemModalOpen, setRedeemModalOpen] = useState(false)
  
  const [coinsInfo, setCoinsInfo] = useState(null)
  const [coinsLoading, setCoinsLoading] = useState(true)
  const [activeTab, setActiveTab] = useState("wallet")
  const [selectedCoinFilter, setSelectedCoinFilter] = useState("earned")
  const [dismissedRequests, setDismissedRequests] = useState(() => {
    try {
      const saved = localStorage.getItem("dismissed_coin_requests")
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })

  const dismissRequest = (id) => {
    const updated = [...dismissedRequests, id]
    setDismissedRequests(updated)
    localStorage.setItem("dismissed_coin_requests", JSON.stringify(updated))
  }

  const fetchWalletData = async () => {
    try {
      setLoading(true)
      setError(null)

      const response = await userAPI.getWallet()
      const walletData = response?.data?.data?.wallet || response?.data?.wallet

      if (walletData) {
        setWallet(walletData)
        setTransactions(walletData.transactions || [])
      }
    } catch (err) {
      debugError("Error fetching wallet:", err)
      setError(err?.response?.data?.message || "Failed to load wallet")
      toast.error("Failed to load wallet data")
    } finally {
      setLoading(false)
    }
  }

  const fetchCoinsData = async () => {
    try {
      setCoinsLoading(true)
      const response = await userAPI.getCoinsInfo()
      if (response?.data?.data) {
        setCoinsInfo(response.data.data)
      }
    } catch (err) {
      debugError("Error fetching coins:", err)
    } finally {
      setCoinsLoading(false)
    }
  }

  useEffect(() => {
    fetchWalletData()
    fetchCoinsData()
  }, [])

  const currentBalance = wallet?.balance || 0

  const referralEarnings = useMemo(() => {
    if (wallet?.referralEarnings != null) {
      return Number(wallet.referralEarnings) || 0
    }

    return transactions
      .filter(
        (transaction) =>
          transaction.type === "addition" &&
          transaction.status === "Completed" &&
          (transaction?.metadata?.source === "referral_signup" ||
            String(transaction.description || "").toLowerCase().startsWith("referral reward"))
      )
      .reduce((sum, transaction) => sum + (Number(transaction.amount) || 0), 0)
  }, [wallet, transactions])

  const filteredTransactions = useMemo(() => {
    if (selectedFilter === TRANSACTION_TYPES.ALL) {
      return transactions
    }

    return transactions.filter((transaction) => {
      if (selectedFilter === TRANSACTION_TYPES.ADDITIONS) {
        return transaction.type === "addition"
      }
      if (selectedFilter === TRANSACTION_TYPES.DEDUCTIONS) {
        return transaction.type === "deduction"
      }
      if (selectedFilter === TRANSACTION_TYPES.REFUNDS) {
        return transaction.type === "refund"
      }
      return true
    })
  }, [selectedFilter, transactions])

  const formatAmount = (amount) => {
    const numeric = Number(amount ?? 0)
    const safe = Number.isFinite(numeric) ? numeric : 0
    return `${"\u20B9"}${safe.toLocaleString("en-IN")}`
  }

  const coinData = useMemo(() => {
    if (!coinsInfo?.transactions) return { activeBatches: [], historyList: [] }

    const now = new Date()

    // 1. Calculate total redeemed/expired coins
    let totalDeductions = coinsInfo.transactions
      .filter((tx) => tx.type === "redeemed" || tx.type === "expired")
      .reduce((sum, tx) => sum + (tx.amount || 0), 0)

    // 2. Clone earned transactions and sort oldest to newest (to apply deductions FIFO)
    const earnedTx = coinsInfo.transactions
      .filter((tx) => tx.type === "earned")
      .map((tx) => ({ 
        ...tx,
        originalAmount: tx.amount,
        activeAmount: 0,
        expiredAmount: 0,
        redeemedAmount: 0
      }))
      .sort((a, b) => new Date(a.createdAt || a.date) - new Date(b.createdAt || b.date))

    // 3. Apply deductions FIFO
    for (const tx of earnedTx) {
      let remaining = tx.amount
      if (totalDeductions > 0) {
        const deduct = Math.min(totalDeductions, remaining)
        tx.redeemedAmount = deduct
        remaining -= deduct
        totalDeductions -= deduct
      }
      
      if (remaining > 0) {
        if (tx.expiresAt && new Date(tx.expiresAt) < now) {
          tx.expiredAmount = remaining
        } else {
          tx.activeAmount = remaining
        }
      }
      tx.amount = remaining
    }

    // 4. Find all active batches (remaining > 0 and not expired yet)
    const activeBatches = earnedTx
      .filter((tx) => tx.activeAmount > 0)
      .map((tx) => ({
        ...tx,
        amount: tx.activeAmount
      }))
      .sort((a, b) => new Date(a.expiresAt) - new Date(b.expiresAt))

    // 5. Compile the history list
    const historyList = []
    
    // Add redeemed transactions directly
    coinsInfo.transactions.forEach((tx) => {
      if (tx.type === "redeemed" || tx.type === "expired") {
        historyList.push(tx)
      }
    })

    // Add earned and dynamically generated expired transactions
    earnedTx.forEach((tx) => {
      historyList.push({
        ...tx,
        type: "earned",
        amount: tx.originalAmount,
        description: tx.description || "Reward Coins Earned"
      })
      
      if (tx.expiredAmount > 0) {
        historyList.push({
          _id: `expired-${tx._id || Math.random()}`,
          amount: tx.expiredAmount,
          type: "expired",
          createdAt: tx.expiresAt,
          date: tx.expiresAt,
          description: `Coins expired from order batch (${tx.description || "Order reward"})`
        })
      }
    })

    // Sort historyList by date/createdAt descending (newest first)
    historyList.sort((a, b) => new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date))

    return { activeBatches, historyList }
  }, [coinsInfo])

  const activeCoinBatches = coinData.activeBatches
  const activeCoinsBalance = useMemo(() => {
    return activeCoinBatches.reduce((sum, batch) => sum + batch.amount, 0)
  }, [activeCoinBatches])

  const formatExpiryDate = (dateString) => {
    if (!dateString) return ""
    const date = new Date(dateString)
    return date.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    })
  }

  const formatDate = (dateString) => {
    if (!dateString) return "N/A"

    const date = new Date(dateString)
    const formattedDate = date.toLocaleDateString("en-IN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
    const formattedTime = date.toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    })

    return `${formattedDate} | ${formattedTime}`
  }

  const visibleRedemptionRequests = useMemo(() => {
    return (coinsInfo?.redemptionRequests || []).filter(
      (req) => !dismissedRequests.includes(req._id || req.id)
    )
  }, [coinsInfo, dismissedRequests])

  const unifiedHistoryList = useMemo(() => {
    const list = []

    // 1. Add earned and expired transactions from coinData.historyList
    coinData.historyList.forEach((tx) => {
      // We skip 'redeemed' type because we represent them as redemption requests
      if (tx.type === "earned" || tx.type === "expired") {
        list.push({
          ...tx,
          id: tx._id || `tx-${tx.createdAt || tx.date}-${Math.random()}`,
          itemType: "transaction"
        })
      }
    })

    // 2. Add visible redemption requests
    visibleRedemptionRequests.forEach((req) => {
      list.push({
        ...req,
        id: req._id || req.id,
        itemType: "redemption_request",
        createdAt: req.createdAt || req.date
      })
    })

    // 3. Sort descending by date
    list.sort((a, b) => new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date))

    return list
  }, [coinData.historyList, visibleRedemptionRequests])

  const filteredUnifiedList = useMemo(() => {
    return unifiedHistoryList.filter((item) => {
      if (selectedCoinFilter === "earned") {
        return item.itemType === "transaction" && item.type === "earned"
      }
      if (selectedCoinFilter === "pending") {
        return item.itemType === "redemption_request" && item.status === "pending"
      }
      if (selectedCoinFilter === "approved") {
        return item.itemType === "redemption_request" && item.status === "approved"
      }
      if (selectedCoinFilter === "rejected") {
        return item.itemType === "redemption_request" && item.status === "rejected"
      }
      if (selectedCoinFilter === "expired") {
        return item.itemType === "transaction" && item.type === "expired"
      }
      return true
    })
  }, [selectedCoinFilter, unifiedHistoryList])

  const getCoinTxIcon = (type) => {
    switch (type) {
      case "earned":
        return <ArrowDownCircle className="h-6 w-6 md:h-7 md:w-7 text-green-600 dark:text-green-400" />
      case "refunded":
        return <RefreshCw className="h-6 w-6 md:h-7 md:w-7 text-blue-600 dark:text-blue-400" />
      case "redeemed":
        return <ArrowUpCircle className="h-6 w-6 md:h-7 md:w-7 text-amber-600 dark:text-amber-400" />
      case "expired":
        return <XCircle className="h-6 w-6 md:h-7 md:w-7 text-gray-500 dark:text-gray-400" />
      default:
        return null
    }
  }

  const getCoinTxColor = (type) => {
    switch (type) {
      case "earned":
        return "text-green-600 dark:text-green-400"
      case "refunded":
        return "text-blue-600 dark:text-blue-400"
      case "redeemed":
        return "text-amber-600 dark:text-amber-400"
      case "expired":
        return "text-gray-550 dark:text-gray-400"
      default:
        return "text-gray-600 dark:text-gray-400"
    }
  }

  const getTransactionIcon = (type) => {
    switch (type) {
      case "addition":
        return <ArrowDownCircle className="h-6 w-6 md:h-7 md:w-7 lg:h-8 lg:w-8 text-green-600 dark:text-green-400" />
      case "deduction":
        return <ArrowUpCircle className="h-6 w-6 md:h-7 md:w-7 lg:h-8 lg:w-8 text-red-600 dark:text-red-400" />
      case "refund":
        return <RefreshCw className="h-6 w-6 md:h-7 md:w-7 lg:h-8 lg:w-8 text-blue-600 dark:text-blue-400" />
      default:
        return null
    }
  }

  const getTransactionColor = (type) => {
    switch (type) {
      case "addition":
        return "text-green-600 dark:text-green-400"
      case "deduction":
        return "text-red-600 dark:text-red-400"
      case "refund":
        return "text-blue-600 dark:text-blue-400"
      default:
        return "text-gray-600 dark:text-gray-400"
    }
  }

  return (
    <AnimatedPage className="min-h-screen bg-white dark:bg-[#0a0a0a] w-full overflow-x-hidden">
      <div className="bg-white dark:bg-[#1a1a1a] sticky top-0 z-10 border-b border-gray-100 dark:border-gray-800">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-3 px-4 sm:px-6 md:px-8 lg:px-10 py-4 md:py-5">
            <button
              onClick={goBack}
              className="w-9 h-9 md:w-10 md:h-10 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors flex-shrink-0"
            >
              <ArrowLeft className="h-5 w-5 md:h-6 md:w-6 text-gray-700 dark:text-white" />
            </button>
            <h1 className="text-lg md:text-xl lg:text-2xl font-bold text-gray-900 dark:text-white">Wallet</h1>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-8 lg:px-10 xl:px-12 py-6 md:py-8 lg:py-10 space-y-6 md:space-y-8">
        {loading && (
          <div className="flex items-center justify-center py-12 md:py-16 lg:py-20">
            <Loader2 className="h-8 w-8 md:h-10 md:w-10 animate-spin text-gray-600 dark:text-gray-400" />
          </div>
        )}

        {error && !loading && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 md:p-6">
            <p className="text-red-600 dark:text-red-400 text-sm md:text-base">{error}</p>
          </div>
        )}

        {!loading && !error && (
          <>
            {coinsInfo?.settings?.isActive && (
              <div className="flex border-b border-gray-100 dark:border-gray-800 gap-6 mb-2">
                <button
                  onClick={() => setActiveTab("wallet")}
                  className={`pb-3 font-bold text-sm md:text-base border-b-2 transition-all flex items-center gap-2 ${
                    activeTab === "wallet"
                      ? "border-green-600 dark:border-green-500 text-green-600 dark:text-green-400"
                      : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                  }`}
                >
                  <span>💼</span> {companyName} Money
                </button>
                <button
                  onClick={() => setActiveTab("coins")}
                  className={`pb-3 font-bold text-sm md:text-base border-b-2 transition-all flex items-center gap-2 ${
                    activeTab === "coins"
                      ? "border-amber-500 dark:border-amber-400 text-amber-500 dark:text-amber-400"
                      : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                  }`}
                >
                  <span>🪙</span> Reward Coins ({activeCoinsBalance || 0})
                </button>
              </div>
            )}

            {activeTab === "wallet" ? (
              <div className="space-y-6 md:space-y-8">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6 md:gap-8 lg:gap-10">
                  <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-6 lg:gap-8 flex-1">
                    <div className="relative flex-shrink-0">
                      <div className="w-20 h-20 md:w-24 md:h-24 lg:w-28 lg:h-28 xl:w-32 xl:h-32 bg-gradient-to-br from-red-500 via-red-600 to-red-700 rounded-xl md:rounded-2xl flex items-center justify-center shadow-lg transform rotate-[-5deg]">
                        <div className="w-16 h-16 md:w-20 md:h-20 lg:w-24 lg:h-24 xl:w-28 xl:h-28 bg-white/10 rounded-lg md:rounded-xl flex items-center justify-center backdrop-blur-sm border border-white/20">
                          <IndianRupee className="h-10 w-10 md:h-12 md:w-12 lg:h-14 lg:w-14 xl:h-16 xl:w-16 text-white" strokeWidth={2.5} />
                        </div>
                      </div>
                      <div className="absolute inset-0 bg-red-800 rounded-xl md:rounded-2xl transform rotate-[-5deg] translate-y-1 -z-10 opacity-25" />
                    </div>

                    <div className="flex flex-col md:items-start items-center text-center md:text-left">
                      <h2 className="text-xl md:text-2xl lg:text-3xl xl:text-4xl font-bold text-gray-900 dark:text-white mb-2 md:mb-3">
                        {companyName} Money
                      </h2>

                      <div className="mb-2 md:mb-3">
                        <p className="text-gray-500 dark:text-gray-400 text-xs md:text-sm lg:text-base mb-1">Current Balance</p>
                        <p className="text-2xl md:text-3xl lg:text-4xl xl:text-5xl 2xl:text-6xl font-bold text-gray-900 dark:text-white">
                          {formatAmount(currentBalance)}
                        </p>
                      </div>

                      <div className="mb-2 md:mb-3">
                        <p className="text-gray-500 dark:text-gray-400 text-xs md:text-sm lg:text-base mb-1">Referral Earnings</p>
                        <p className="text-lg md:text-xl lg:text-2xl font-semibold text-green-600 dark:text-green-400">
                          {formatAmount(referralEarnings)}
                        </p>
                      </div>

                      <p className="text-gray-500 dark:text-gray-400 text-xs md:text-sm lg:text-base text-center md:text-left max-w-md">
                        Add money to enjoy one-tap, seamless payments
                      </p>
                    </div>
                  </div>

                  <div className="flex-shrink-0 w-full md:w-auto">
                    <Button
                      className="w-full md:w-auto md:min-w-[200px] lg:min-w-[240px] h-12 md:h-14 lg:h-16 text-white font-semibold text-sm md:text-base lg:text-lg rounded-xl transition-all duration-200 flex items-center justify-center gap-2"
                      style={{
                        background:
                          "linear-gradient(135deg, rgba(var(--module-theme-rgb,250,2,114),0.94), var(--module-theme-color,#FA0272))",
                        boxShadow:
                          "0 12px 24px rgba(var(--module-theme-rgb,250,2,114),0.30)",
                      }}
                      onClick={() => setAddMoneyModalOpen(true)}
                    >
                      <Plus className="h-4 w-4 md:h-5 md:w-5 lg:h-6 lg:w-6" />
                      Add money
                    </Button>
                  </div>
                </div>

                <div className="space-y-4 md:space-y-6 lg:space-y-8">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 md:gap-6">
                    <h2 className="text-xs sm:text-sm md:text-base lg:text-lg font-semibold text-gray-400 dark:text-gray-500 tracking-widest uppercase">
                      TRANSACTION HISTORY
                    </h2>

                    <div className="flex gap-2 md:gap-3 overflow-x-auto md:overflow-x-visible scrollbar-hide pb-2 md:pb-0">
                      {[
                        { id: TRANSACTION_TYPES.ALL, label: "All Transactions" },
                        { id: TRANSACTION_TYPES.ADDITIONS, label: "Additions" },
                        { id: TRANSACTION_TYPES.DEDUCTIONS, label: "Deductions" },
                        { id: TRANSACTION_TYPES.REFUNDS, label: "Refunds" },
                      ].map((filter) => {
                        const isSelected = selectedFilter === filter.id
                        return (
                          <button
                            key={filter.id}
                            onClick={() => setSelectedFilter(filter.id)}
                            className={`px-4 md:px-5 lg:px-6 py-2 md:py-2.5 lg:py-3 rounded-lg md:rounded-xl text-xs md:text-sm lg:text-base font-medium whitespace-nowrap flex-shrink-0 transition-all ${
                              isSelected
                                ? "bg-white dark:bg-[#1a1a1a] border-2 border-green-600 dark:border-green-500 text-green-600 dark:text-green-400 shadow-sm"
                                : "bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-700 hover:shadow-sm"
                            }`}
                          >
                            {filter.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {filteredTransactions.length > 0 ? (
                    <div className="space-y-3 md:space-y-4">
                      {filteredTransactions.map((transaction) => (
                        <Card
                          key={transaction.id}
                          className="py-0 border border-gray-100 dark:border-gray-800 shadow-sm dark:bg-[#1a1a1a] hover:shadow-md transition-all duration-200 cursor-pointer"
                        >
                          <CardContent className="p-4 md:p-5 lg:p-6">
                            <div className="flex items-center justify-between gap-4 md:gap-6">
                              <div className="flex items-center gap-4 md:gap-5 lg:gap-6 flex-1 min-w-0">
                                <div className="flex-shrink-0">
                                  <div className="w-12 h-12 md:w-14 md:h-14 lg:w-16 lg:h-16 flex items-center justify-center rounded-full bg-gray-50 dark:bg-gray-800/50">
                                    {getTransactionIcon(transaction.type)}
                                  </div>
                                </div>

                                <div className="flex-1 min-w-0">
                                  <p className="text-gray-900 dark:text-white font-semibold text-sm md:text-base lg:text-lg truncate mb-1">
                                    {transaction.description}
                                  </p>
                                  {(transaction?.metadata?.source === "referral_signup" ||
                                    String(transaction.description || "").toLowerCase().startsWith("referral reward")) && (
                                    <p className="text-[11px] md:text-xs text-green-600 dark:text-green-400 font-medium mb-1">
                                      Referral reward
                                    </p>
                                  )}
                                  <p className="text-gray-500 dark:text-gray-400 text-xs md:text-sm lg:text-base">
                                    {formatDate(transaction.date || transaction.createdAt)}
                                  </p>
                                </div>
                              </div>

                              <div className={`flex-shrink-0 font-bold text-lg md:text-xl lg:text-2xl ${getTransactionColor(transaction.type)}`}>
                                {transaction.type === "deduction" ? "-" : "+"}
                                {formatAmount(transaction.amount)}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  ) : (
                    <div className="py-12 md:py-16 lg:py-20 xl:py-24">
                      <div className="space-y-3 md:space-y-4 mb-6 md:mb-8 max-w-2xl mx-auto">
                        {[1, 2, 3].map((i) => (
                          <div
                            key={i}
                            className="flex items-center gap-3 md:gap-4 bg-gray-100 dark:bg-gray-800 rounded-xl px-4 md:px-5 lg:px-6 py-3 md:py-4"
                            style={{
                              opacity: 0.3 + i * 0.15,
                            }}
                          >
                            <div className="w-10 h-10 md:w-12 md:h-12 bg-gray-200 dark:bg-gray-700 rounded-lg flex-shrink-0" />
                            <div className="flex-1 space-y-2">
                              <div className="h-3 md:h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
                              <div className="h-2 md:h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
                            </div>
                          </div>
                        ))}
                      </div>

                      <p className="text-gray-600 dark:text-gray-400 text-sm md:text-base lg:text-lg text-center font-medium">
                        Your transactions will appear here
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-6 md:space-y-8">
                {/* Coins Balance Card */}
                {coinsInfo?.settings?.isActive && (
                  <div className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 border border-amber-200 dark:border-amber-800/30 rounded-2xl p-5 md:p-6 lg:p-8 flex flex-col gap-5 shadow-sm">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 md:w-14 md:h-14 rounded-full bg-amber-100 dark:bg-amber-800/40 flex items-center justify-center flex-shrink-0 border border-amber-300/50 dark:border-amber-700/50">
                          <span className="text-2xl md:text-3xl">🪙</span>
                        </div>
                        <div>
                          <h3 className="text-lg md:text-xl font-bold text-amber-900 dark:text-amber-100">Reward Coins</h3>
                          <p className="text-sm md:text-base text-amber-700 dark:text-amber-300/80 mt-1">
                            {coinsLoading ? (
                              <Loader2 className="h-4 w-4 animate-spin inline" />
                            ) : (
                              <>You have <strong className="text-amber-600 dark:text-amber-400 font-bold">{activeCoinsBalance || 0}</strong> valid coins</>
                            )}
                          </p>
                        </div>
                      </div>
                      
                      <Button
                        onClick={() => setRedeemModalOpen(true)}
                        disabled={coinsLoading || !activeCoinsBalance || activeCoinsBalance <= 0}
                        className="bg-amber-500 hover:bg-amber-600 text-white font-medium shadow-sm transition-colors border-0 w-full md:w-auto"
                      >
                        Redeem Coins
                      </Button>
                    </div>

                    {!coinsLoading && activeCoinBatches.length > 0 && (
                      <div className="border-t border-amber-200/40 dark:border-amber-800/20 pt-4">
                        <p className="text-[11px] font-bold text-amber-800/85 dark:text-amber-300/85 uppercase tracking-wider mb-2">
                          Coins Expiry Schedule
                        </p>
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                          {activeCoinBatches.map((batch, index) => (
                            <div
                              key={batch._id || index}
                              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm text-amber-800 dark:text-amber-300 bg-amber-100/40 dark:bg-amber-900/20 p-4 rounded-xl border border-amber-200/30 dark:border-amber-800/10 shadow-sm"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-lg">🪙</span>
                                <span className="font-bold text-amber-950 dark:text-white text-base">{batch.amount}</span>
                                <span className="text-amber-600 dark:text-amber-400 text-xs truncate">
                                  ({batch.description})
                                </span>
                              </div>
                              <div className="flex items-center gap-1 text-xs font-semibold flex-shrink-0 text-amber-700 dark:text-amber-400">
                                <span>⏳ Expires</span>
                                <strong>{formatExpiryDate(batch.expiresAt)}</strong>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Coin History & Requests */}
                <div className="space-y-4 md:space-y-6 lg:space-y-8 w-full max-w-full overflow-hidden">
                  <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 w-full overflow-hidden border-b border-gray-100 dark:border-gray-800 pb-2">
                    <h2 className="text-xs sm:text-sm md:text-base lg:text-lg font-semibold text-gray-400 dark:text-gray-500 tracking-widest uppercase flex-shrink-0">
                      COIN HISTORY & REQUESTS
                    </h2>

                    <div className="w-full lg:w-auto overflow-x-auto scrollbar-hide">
                      <div className="flex gap-2 md:gap-3">
                        {[
                          { id: "earned", label: "Earned" },
                          { id: "pending", label: "Pending" },
                          { id: "approved", label: "Approved" },
                          { id: "rejected", label: "Rejected" },
                          { id: "expired", label: "Expired" },
                        ].map((filter) => {
                          const isSelected = selectedCoinFilter === filter.id
                          return (
                            <button
                              key={filter.id}
                              onClick={() => setSelectedCoinFilter(filter.id)}
                              className={`px-4 md:px-5 lg:px-6 py-2 md:py-2.5 lg:py-3 rounded-lg md:rounded-xl text-xs md:text-sm lg:text-base font-medium whitespace-nowrap flex-shrink-0 transition-all ${
                                isSelected
                                  ? "bg-white dark:bg-[#1a1a1a] border-2 border-amber-500 dark:border-amber-500 text-amber-600 dark:text-amber-400 shadow-sm"
                                  : "bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-700 hover:shadow-sm"
                              }`}
                            >
                              {filter.label}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </div>

                  {filteredUnifiedList.length > 0 ? (
                    <div className="grid gap-4 md:grid-cols-2 max-w-3xl mx-auto w-full">
                      {filteredUnifiedList.map((item, idx) => {
                        if (item.itemType === "redemption_request") {
                          return (
                            <Card
                              key={item.id || idx}
                              className="border border-gray-100 dark:border-gray-800 shadow-sm dark:bg-[#1a1a1a] hover:shadow-md transition-all duration-200"
                            >
                              <CardContent className="p-4 flex flex-col justify-between h-full gap-2">
                                <div className="flex flex-row items-start justify-between gap-2 w-full">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="text-lg">🪙</span>
                                      <span className="font-bold text-gray-900 dark:text-white text-sm sm:text-base md:text-lg">
                                        {item.coinsRedeemed} Coins
                                      </span>
                                      <span className="text-gray-400 dark:text-gray-500 text-sm">→</span>
                                      <span className="font-bold text-green-600 dark:text-green-400 text-sm sm:text-base md:text-lg">
                                        {formatAmount(item.amountToCredit)}
                                      </span>
                                    </div>
                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                      Requested on {formatDate(item.createdAt)}
                                    </p>
                                  </div>

                                  <span
                                    className={`px-2 py-0.5 rounded-full text-[11px] sm:text-xs font-semibold capitalize border flex-shrink-0 ${
                                      item.status === "approved"
                                        ? "bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400 border-green-200 dark:border-green-900/30"
                                        : item.status === "rejected"
                                        ? "bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400 border-red-200 dark:border-red-900/30"
                                        : "bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-900/30"
                                    }`}
                                  >
                                    {item.status}
                                  </span>
                                </div>

                                {item.adminNote && (
                                  <div className="text-xs bg-gray-50 dark:bg-[#0a0a0a] border border-gray-100 dark:border-gray-800/50 p-2.5 rounded-lg text-gray-600 dark:text-gray-400">
                                    <strong className="font-semibold text-gray-755 dark:text-gray-350">Admin Note:</strong> {item.adminNote}
                                  </div>
                                )}

                                <div className="flex items-center justify-between border-t border-gray-100 dark:border-gray-800/60 pt-2 text-xs">
                                  <a
                                    href={item.screenshotUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-medium inline-flex items-center gap-1"
                                  >
                                    View Screenshot ↗
                                  </a>
                                  {item.processedAt && (
                                    <span className="text-gray-400 dark:text-gray-500">
                                      Processed: {new Date(item.processedAt).toLocaleDateString("en-IN")}
                                    </span>
                                  )}
                                </div>
                              </CardContent>
                            </Card>
                          )
                        } else {
                          // Transaction item
                          const isExpired = item.type === "expired"
                          return (
                            <Card
                              key={item.id || idx}
                              className="py-0 border border-gray-100 dark:border-gray-800 shadow-sm dark:bg-[#1a1a1a] hover:shadow-md transition-all duration-200"
                            >
                              <CardContent className="p-6">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 w-full min-w-0">
                                  <div className="flex items-start gap-4 flex-1 min-w-0 w-full">
                                    <div className="flex-shrink-0">
                                      <div className="w-12 h-12 md:w-14 md:h-14 lg:w-16 lg:h-16 flex items-center justify-center rounded-full bg-gray-50 dark:bg-gray-800/50">
                                        {isExpired ? (
                                          <XCircle className="h-6 w-6 md:h-7 md:w-7 text-gray-550 dark:text-gray-455" />
                                        ) : (
                                          <ArrowDownCircle className="h-6 w-6 md:h-7 md:w-7 text-green-600 dark:text-green-400" />
                                        )}
                                      </div>
                                    </div>

                                    <div className="flex-1 min-w-0">
                                      <p className="text-gray-900 dark:text-white font-semibold text-sm md:text-base lg:text-lg break-all mb-1">
                                        {item.description || (isExpired ? "Coins Expired" : "Reward Coins Earned")}
                                      </p>
                                      <p className="text-gray-500 dark:text-gray-400 text-xs md:text-sm lg:text-base">
                                        {formatDate(item.createdAt || item.date)}
                                      </p>
                                      {!isExpired && item.expiresAt && (
                                        <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium mt-1">
                                          ⏳ Expires on {formatExpiryDate(item.expiresAt)}
                                        </p>
                                      )}
                                    </div>
                                  </div>

                                  <div className={`font-bold text-lg md:text-xl lg:text-2xl flex-shrink-0 self-start sm:self-center pl-16 sm:pl-0 ${isExpired ? "text-gray-500 dark:text-gray-400" : "text-green-600 dark:text-green-400"}`}>
                                    {isExpired ? "-" : "+"} {item.amount} Coins
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          )
                        }
                      })}
                    </div>
                  ) : (
                    <div className="py-12 md:py-16 lg:py-20">
                      <p className="text-gray-600 dark:text-gray-400 text-sm md:text-base lg:text-lg text-center font-medium">
                        No transactions or requests found under this filter
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <AddMoneyModal
        open={addMoneyModalOpen}
        onOpenChange={setAddMoneyModalOpen}
        onSuccess={fetchWalletData}
      />

      {coinsInfo?.settings && (
        <RedeemCoinsModal
          open={redeemModalOpen}
          onOpenChange={setRedeemModalOpen}
          coinsInfo={coinsInfo}
          onSuccess={() => {
            fetchWalletData()
            fetchCoinsData()
          }}
        />
      )}
    </AnimatedPage>
  )
}
