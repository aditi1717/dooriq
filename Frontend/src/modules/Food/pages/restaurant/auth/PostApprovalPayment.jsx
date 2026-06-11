import { useEffect, useLayoutEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Button } from "@food/components/ui/button"
import { Input } from "@food/components/ui/input"
import { Label } from "@food/components/ui/label"
import { Skeleton } from "@food/components/ui/skeleton"
import { restaurantAPI } from "@food/api"
import { getModuleToken, getModuleRefreshToken, setAuthData as setModuleAuthData } from "@food/utils/auth"
import { clearModuleAuth } from "@food/utils/auth"
import { toast } from "sonner"

const GST_RATE = 0.18
const STATIC_SUBSCRIPTION_COLOR = "#FA0272"

export default function PostApprovalPayment() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [settings, setSettings] = useState(null)
  const [loadError, setLoadError] = useState("")
  const [paymentType, setPaymentType] = useState("full")
  const [partialAmount, setPartialAmount] = useState("")
  const [plan, setPlan] = useState("starter")
  const [planSelectionWarning, setPlanSelectionWarning] = useState("")
  const [attemptedPlanId, setAttemptedPlanId] = useState("")
  const [mode, setMode] = useState("onboarding")
  const [planCatalog, setPlanCatalog] = useState([])
  const [gmvLast30Days, setGmvLast30Days] = useState(0)
  const cachedFeatureFlag = typeof window !== "undefined"
    ? localStorage.getItem("restaurant_subscription_feature_enabled")
    : null

  useLayoutEffect(() => {
    if (cachedFeatureFlag === "false") {
      navigate("/food/restaurant", { replace: true })
    }
  }, [cachedFeatureFlag, navigate])

  if (cachedFeatureFlag === "false") {
    return null
  }

  useEffect(() => {
    let mounted = true
    const load = async () => {
      try {
        setLoadError("")
        const [restaurantRes, featureRes] = await Promise.all([
          restaurantAPI.getCurrentRestaurant(),
          restaurantAPI.getFeatureSettingsPublic(),
        ])
        if (!mounted) return

        const rows = Array.isArray(featureRes?.data?.data) ? featureRes.data.data : []
        const feature = rows.find((row) => row.key === "restaurant_subscription")
        const isSubscriptionEnabled = feature ? Boolean(feature.isEnabled) : true
        localStorage.setItem("restaurant_subscription_feature_enabled", String(isSubscriptionEnabled))
        if (!isSubscriptionEnabled) {
          navigate("/food/restaurant", { replace: true })
          return
        }

        const restaurant =
          restaurantRes?.data?.data?.restaurant ||
          restaurantRes?.data?.restaurant

        const expiryMs = restaurant?.subscriptionValidTill ? new Date(restaurant.subscriptionValidTill).getTime() : NaN
        const isExpired = Number.isFinite(expiryMs) && expiryMs < Date.now()
        const nextMode = restaurant?.onboardingFeePaid ? (isExpired ? "renewal" : "none") : "onboarding"
        if (nextMode === "none") {
          navigate("/food/restaurant", { replace: true })
          return
        }
        setMode(nextMode)

        const settingsRes = await restaurantAPI.getSubscriptionSettings()
        if (!mounted) return
        const s = settingsRes?.data?.data || null
        if (!s) throw new Error("Subscription settings missing")

        const eligibility = restaurant?.subscriptionEligibility || {}
        const eligibilityPlan = String(eligibility?.eligiblePlan || "starter").toLowerCase()
        const catalog = Array.isArray(eligibility?.planCatalog) ? eligibility.planCatalog : [
          { id: "starter", label: "Starter", basePrice: Number(s.starterPrice || 999) },
          { id: "growth", label: "Growth", basePrice: Number(s.growthPrice || 1999) },
          { id: "premium", label: "Premium", basePrice: Number(s.premiumPrice || 2999) },
        ]
        setPlanCatalog(catalog)
        setPlan(eligibilityPlan)
        setGmvLast30Days(Number(eligibility?.gmvLast30Days || 0))
        setSettings(s)
      } catch (err) {
        const featureDisabledByMessage = /feature|subscription.*disabled/i.test(
          err?.response?.data?.message || err?.message || ""
        )
        if (featureDisabledByMessage) {
          navigate("/food/restaurant", { replace: true })
          return
        }
        toast.error(err?.response?.data?.message || "Failed to load payment details")
        if (mounted) {
          setLoadError("Unable to load payment details. Please retry.")
          setSettings(null)
        }
      } finally {
        if (mounted) setLoading(false)
      }
    }

    load()
    return () => {
      mounted = false
    }
  }, [navigate])

  const calc = useMemo(() => {
    if (!settings) return null

    const starterPrice = Number(settings.starterPrice || 999)
    const growthPrice = Number(settings.growthPrice || 1999)
    const premiumPrice = Number(settings.premiumPrice || 2999)
    const onboardingFeeBase = Math.max(0, Number(settings.onboardingFee ?? 799))

    const selectedPlanBase =
      plan === "premium" ? premiumPrice : plan === "growth" ? growthPrice : starterPrice
    const selectedPlanGST = Math.round(selectedPlanBase * GST_RATE)
    const subscriptionPlanTotal = selectedPlanBase + selectedPlanGST

    const onboardingGST = Math.round(onboardingFeeBase * GST_RATE)
    const onboardingFeeTotal = mode === "onboarding" ? onboardingFeeBase + onboardingGST : 0

    const partialBase = Number(partialAmount || 0)
    let subscriptionPaidNowBase = 0

    if (paymentType === "full") subscriptionPaidNowBase = selectedPlanBase
    if (paymentType === "partial") subscriptionPaidNowBase = Math.max(0, Math.min(partialBase, selectedPlanBase))

    const subscriptionPaidNowGST = Math.round(subscriptionPaidNowBase * GST_RATE)
    const subscriptionPaidNowTotal = subscriptionPaidNowBase + subscriptionPaidNowGST
    const subscriptionDueLaterTotal = Math.max(0, subscriptionPlanTotal - subscriptionPaidNowTotal)
    const payableNow = onboardingFeeTotal + subscriptionPaidNowTotal

    return {
      starterPrice,
      growthPrice,
      premiumPrice,
      onboardingFeeBase,
      onboardingGST,
      onboardingFeeTotal,
      selectedPlanBase,
      selectedPlanGST,
      subscriptionPlanTotal,
      subscriptionPaidNowBase,
      subscriptionPaidNowGST,
      subscriptionPaidNowTotal,
      subscriptionDueLaterTotal,
      payableNow,
    }
  }, [settings, plan, paymentType, partialAmount, mode])

  const hasOnboardingFee = mode === "onboarding" && Number(calc?.onboardingFeeTotal || 0) > 0

  const paymentInfoContent = useMemo(() => ({
    full: mode === "onboarding"
      ? hasOnboardingFee
        ? "Pay now: Onboarding fee and the selected plan are charged right away. From the next cycle onward, regular due rules apply."
        : "Pay now: The selected plan is charged right away. From the next cycle onward, regular due rules apply."
      : "Pay now: The full selected plan amount is charged right away. Once dues are cleared, the remaining wallet balance stays available.",
    partial: mode === "onboarding"
      ? hasOnboardingFee
        ? "Pay partial: Onboarding fee is mandatory now. A partial plan amount is paid now and the rest becomes due. Due is auto-deducted when available earnings reach the due amount."
        : "Pay partial: A partial plan amount is paid now and the rest becomes due. Due is auto-deducted when available earnings reach the due amount."
      : "Pay partial: A partial plan amount is paid now and the rest becomes due. Due auto-settles when available earnings can fully cover it.",
    later: mode === "onboarding"
      ? hasOnboardingFee
        ? "Pay later: Only onboarding fee is charged now. The full plan amount becomes due and will auto-deduct from available earnings once balance is sufficient."
        : "Pay later: Nothing is charged now. The full plan amount becomes due and will auto-deduct from available earnings once balance is sufficient."
      : "Pay later: Nothing is charged now. The full plan amount becomes due and will auto-deduct from available earnings once balance is sufficient.",
  }), [hasOnboardingFee, mode])

  const handleCreateOrder = async () => {
    if (!calc) {
      toast.error("Please select a subscription plan")
      return
    }

    if (paymentType === "partial") {
      const partialBase = Number(partialAmount || 0)
      if (!Number.isFinite(partialBase) || partialBase <= 0) {
        toast.error("Please enter a valid partial amount")
        return
      }
      if (partialBase > calc.selectedPlanBase) {
        toast.error(`Partial amount cannot exceed ₹${calc.selectedPlanBase}`)
        return
      }
    }

    setProcessing(true)
    try {
      const body = {
        subscriptionPlan: plan,
        subscriptionPaymentType: paymentType,
        mode,
      }
      if (paymentType === "partial") {
        body.subscriptionPartialAmount = Number(partialAmount || 0)
      }

      const res = await restaurantAPI.createPostApprovalOnboardingOrder(body)
      const orderData = res?.data?.data
      if (orderData?.paymentRequired === false && orderData?.completed) {
        const completedRestaurant = orderData?.restaurant || null
        if (completedRestaurant) {
          try {
            const token = getModuleToken("restaurant")
            const refresh = getModuleRefreshToken("restaurant")
            if (token) {
              setModuleAuthData("restaurant", token, completedRestaurant, refresh)
            }
          } catch {
            // no-op: navigation will refresh the restaurant state
          }
        }

        window.dispatchEvent(new Event("restaurantAuthChanged"))
        toast.success("Account activated. Subscription amount added to dues.")
        navigate("/food/restaurant", { replace: true })
        return
      }

      if (!orderData?.razorpay) throw new Error("Failed to create payment order")

      const { loadRazorpayScript, initRazorpayPayment } = await import("@food/utils/razorpay")
      await loadRazorpayScript()

      await initRazorpayPayment({
        key: orderData.razorpay.key,
        amount: orderData.razorpay.amount,
        currency: "INR",
        order_id: orderData.razorpay.orderId,
        name: "Restaurant onboarding",
        description: "Activation payment",
        handler: async (response) => {
          try {
            const verifyRes = await restaurantAPI.verifyPostApprovalOnboardingPayment({
              razorpayOrderId: orderData.razorpay.orderId,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
              subscriptionPlan: plan,
              subscriptionPaymentType: paymentType,
              subscriptionPartialAmount: paymentType === "partial" ? Number(partialAmount || 0) : 0,
              mode,
            })

            const verifiedRestaurant =
              verifyRes?.data?.data?.restaurant ||
              verifyRes?.data?.restaurant ||
              null

            if (verifiedRestaurant) {
              try {
                const token = getModuleToken("restaurant")
                const refresh = getModuleRefreshToken("restaurant")
                if (token) {
                  setModuleAuthData("restaurant", token, verifiedRestaurant, refresh)
                }
              } catch {
                // no-op: fallback to dashboard navigation
              }
            }

            window.dispatchEvent(new Event("restaurantAuthChanged"))

            toast.success("Payment successful. Dashboard unlocked.")
            navigate("/food/restaurant", { replace: true })
          } catch (err) {
            toast.error(err?.response?.data?.message || err?.message || "Payment verification failed")
          } finally {
            setProcessing(false)
          }
        },
        onClose: () => setProcessing(false),
        onError: (err) => {
          toast.error(err?.description || "Payment failed")
          setProcessing(false)
        },
      })
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || "Failed to initiate payment")
      setProcessing(false)
    }
  }

  const handleBackToLogin = () => {
    try {
      clearModuleAuth("restaurant")
    } catch {
      // ignore auth-clear issues and proceed to login
    }
    navigate("/food/restaurant/login", { replace: true })
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <header className="bg-white border-b border-slate-200 px-5 py-4">
          <Skeleton className="h-6 w-44 rounded-lg" />
          <Skeleton className="h-4 w-64 mt-2 rounded-lg" />
        </header>
        <main className="flex-1 p-4 space-y-6 max-w-lg w-full mx-auto">
          <section className="rounded-3xl bg-white border border-slate-100 p-6 shadow-sm">
            <Skeleton className="h-8 w-40 mb-4 rounded-lg" />
            <Skeleton className="h-24 w-full rounded-2xl" />
          </section>

          <section className="space-y-4">
            <Skeleton className="h-6 w-44 rounded-lg" />
            <Skeleton className="h-32 w-full rounded-3xl" />
            <Skeleton className="h-32 w-full rounded-3xl" />
          </section>
        </main>
      </div>
    )
  }

  if (!calc) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl border border-red-200 p-5 text-sm text-red-600 font-medium shadow-sm flex items-center gap-3">
          <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          Failed to load payment details. Please refresh and try again.
        </div>
      </div>
    )
  }

  const isPlanSelected = Boolean(plan)

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      <header className="bg-white px-5 py-4 border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-lg mx-auto">
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Activate Account</h1>
          <p className="text-sm text-slate-500 mt-1 font-medium">
            {calc.payableNow > 0 ? "Finish payment to unlock your dashboard" : "Finish setup to unlock your dashboard"}
          </p>
        </div>
      </header>

      <main className="flex-1 p-4 space-y-6 max-w-lg w-full mx-auto pb-6">
        {loadError && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 flex items-start gap-3 text-red-700 shadow-sm animate-in fade-in slide-in-from-top-2">
            <svg className="w-5 h-5 shrink-0 text-red-500 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <span className="text-sm font-medium leading-tight">{loadError}</span>
          </div>
        )}

        {/* 1. Onboarding / Renewal Card */}
        <section className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100 relative overflow-hidden">
          <div className="flex items-center gap-4 mb-5 relative z-10">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${STATIC_SUBSCRIPTION_COLOR}15`, color: STATIC_SUBSCRIPTION_COLOR }}>
              {mode === "renewal" ? (
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              ) : (
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
              )}
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 tracking-tight">{mode === "onboarding" ? "Onboarding Setup" : "Subscription Renewal"}</h2>
              <p className="text-sm text-slate-500 mt-0.5 font-medium">{mode === "onboarding" ? "Mandatory setup & activation" : "Action required to continue"}</p>
            </div>
          </div>

          {mode === "renewal" ? (
            <div className="rounded-2xl bg-red-50 p-4 border border-red-100 relative z-10">
              <p className="text-sm text-red-800 font-medium leading-relaxed mb-3">
                Your subscription has expired. Please renew now to restore full access to your dashboard.
              </p>
              <div className="flex justify-between items-center bg-white rounded-xl px-3 py-2 border border-red-100 shadow-sm">
                <span className="text-xs font-semibold text-red-600 uppercase tracking-wider">30-day GMV</span>
                <span className="font-bold text-red-700">₹{Number(gmvLast30Days || 0).toFixed(2)}</span>
              </div>
            </div>
          ) : hasOnboardingFee ? (
            <div className="rounded-2xl bg-slate-50 p-4 border border-slate-100 relative z-10">
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-slate-600 font-medium text-sm">Setup Fee (Base)</span>
                <span className="text-slate-900 font-bold text-sm">₹{calc.onboardingFeeBase}</span>
              </div>
              <div className="flex justify-between items-center mb-3">
                <span className="text-slate-500 text-sm">GST (18%)</span>
                <span className="text-slate-500 text-sm font-medium">₹{calc.onboardingGST}</span>
              </div>
              <div className="flex justify-between items-center pt-3 border-t border-slate-200 border-dashed">
                <span className="font-bold text-slate-900">Onboarding Total</span>
                <span className="font-bold text-lg" style={{ color: STATIC_SUBSCRIPTION_COLOR }}>₹{calc.onboardingFeeTotal}</span>
              </div>
            </div>
          ) : null}
        </section>

        {/* 2. Subscription Plan */}
        <section className="space-y-4">
          <div className="px-1">
            <h3 className="text-lg font-bold text-slate-900 tracking-tight">Subscription Plan</h3>
            <p className="text-sm text-slate-500 mt-1 leading-relaxed">
              Based on your 30-day GMV <span className="font-semibold text-slate-700">(₹{Number(gmvLast30Days || 0).toFixed(2)})</span>. Other plans are locked.
            </p>
          </div>

          <div className="grid gap-3">
            {planCatalog.map((catalogPlan) => {
              const total = Number(catalogPlan?.basePrice || 0) + Math.round(Number(catalogPlan?.basePrice || 0) * GST_RATE)
              const title = `${String(catalogPlan?.label || catalogPlan?.id || "").trim()}`
              const gmvMin = Number(catalogPlan?.gmvMin || 0)
              const gmvMaxRaw = catalogPlan?.gmvMax
              const hasMax = Number.isFinite(Number(gmvMaxRaw))
              const gmvLabel = hasMax
                ? `GMV: ₹${gmvMin.toFixed(2)} - ₹${Number(gmvMaxRaw).toFixed(2)}`
                : `GMV: ₹${gmvMin.toFixed(2)}+`
              
              const isPremium = catalogPlan?.id === "premium"
              const p = { id: catalogPlan?.id, title, total, features: ["Platform features", "Support included", isPremium ? "Priority delivery" : "Standard tools"].filter(Boolean) }
              const selected = plan === p.id
              const attempted = attemptedPlanId === p.id && !selected
              
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    if (selected) {
                      setAttemptedPlanId("")
                      setPlanSelectionWarning("")
                      return
                    }
                    setAttemptedPlanId(p.id)
                    setPlanSelectionWarning(`Eligible for ${String(plan || "starter").toUpperCase()} based on GMV.`)
                  }}
                  className={`w-full relative overflow-hidden rounded-3xl p-5 text-left transition-all duration-300 border-2 group ${
                    selected 
                      ? "bg-white shadow-md z-10 scale-[1.01]" 
                      : attempted
                      ? "border-amber-200 bg-amber-50"
                      : "border-slate-100 bg-white hover:border-slate-200 hover:shadow-sm"
                  }`}
                  style={{ borderColor: selected ? STATIC_SUBSCRIPTION_COLOR : undefined }}
                >
                  {selected && (
                    <div className="absolute top-0 right-0 w-32 h-32 opacity-[0.03] pointer-events-none rounded-bl-full transition-transform duration-500 scale-110" style={{ backgroundColor: STATIC_SUBSCRIPTION_COLOR }} />
                  )}
                  
                  <div className="flex items-start justify-between gap-4 relative z-10">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-xl font-extrabold tracking-tight text-slate-900">{p.title}</p>
                        {selected && <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-md" style={{ backgroundColor: `${STATIC_SUBSCRIPTION_COLOR}15`, color: STATIC_SUBSCRIPTION_COLOR }}>Selected</span>}
                      </div>
                      
                      <div className="flex items-baseline gap-1 mb-3">
                        <span className="text-2xl font-black text-slate-900">₹{p.total}</span>
                        <span className="text-sm font-medium text-slate-500">/mo</span>
                      </div>
                      
                      <p className="text-xs font-semibold text-slate-600 bg-slate-100 inline-block px-2.5 py-1 rounded-lg border border-slate-200 mb-4">{gmvLabel}</p>
                      
                      <ul className="space-y-2.5">
                        {p.features.map((f) => (
                          <li key={f} className="flex items-center text-sm font-medium text-slate-600">
                            <svg className="w-4 h-4 mr-2 shrink-0" style={{ color: selected ? STATIC_SUBSCRIPTION_COLOR : '#94a3b8' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                            </svg>
                            {f}
                          </li>
                        ))}
                      </ul>
                    </div>
                    
                    <div className={`mt-1 flex items-center justify-center w-7 h-7 rounded-full border-2 transition-all duration-300 shrink-0 shadow-sm ${selected ? 'scale-110' : 'border-slate-300 bg-slate-50 group-hover:border-slate-400'}`} style={{ borderColor: selected ? STATIC_SUBSCRIPTION_COLOR : undefined, backgroundColor: selected ? STATIC_SUBSCRIPTION_COLOR : undefined }}>
                      {selected && <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>

          {planSelectionWarning && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3.5 flex items-start gap-3 shadow-sm animate-in fade-in slide-in-from-top-1">
              <svg className="w-5 h-5 shrink-0 text-amber-500 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              <p className="text-sm font-medium text-amber-800 leading-tight">{planSelectionWarning}</p>
            </div>
          )}
        </section>

        {/* 3. Payment Option */}
        {isPlanSelected && (
          <section className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="px-1">
              <h3 className="text-lg font-bold text-slate-900 tracking-tight">Payment Options</h3>
            </div>

            <div className="grid gap-3">
              {[
                { id: "full", title: "Pay Full Now", desc: "Pay the complete amount and clear all dues instantly." },
                { id: "partial", title: "Pay Partial", desc: "Pay a custom amount now, rest will be auto-deducted later." },
                { id: "later", title: "Pay Later", desc: hasOnboardingFee ? "Pay only onboarding fee now." : "Pay nothing now, auto-deduct later." }
              ].map((opt) => {
                const selected = paymentType === opt.id
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      setPaymentType(opt.id)
                      if (opt.id !== "partial") setPartialAmount("")
                    }}
                    className={`w-full flex items-center gap-4 rounded-2xl p-4 text-left transition-all duration-200 border-2 group ${
                      selected ? "bg-white shadow-md z-10" : "border-slate-100 bg-white hover:border-slate-200 hover:shadow-sm"
                    }`}
                    style={{ borderColor: selected ? STATIC_SUBSCRIPTION_COLOR : undefined }}
                  >
                    <div className={`shrink-0 flex items-center justify-center w-6 h-6 rounded-full border-2 transition-colors ${selected ? '' : 'border-slate-300 group-hover:border-slate-400'}`} style={{ borderColor: selected ? STATIC_SUBSCRIPTION_COLOR : undefined }}>
                      {selected && <div className="w-3 h-3 rounded-full animate-in zoom-in" style={{ backgroundColor: STATIC_SUBSCRIPTION_COLOR }} />}
                    </div>
                    <div>
                      <p className="text-base font-bold text-slate-900">{opt.title}</p>
                      <p className="text-xs text-slate-500 mt-0.5 leading-relaxed font-medium">{opt.desc}</p>
                      <p className="text-[11px] leading-4 mt-2 font-medium text-slate-900">{paymentInfoContent[opt.id]}</p>
                    </div>
                  </button>
                )
              })}
            </div>

            {paymentType === "partial" && (
              <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-sm transition-all animate-in fade-in slide-in-from-top-2">
                <Label className="text-sm font-bold text-slate-900 block mb-2">Partial Amount (Base)</Label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <span className="text-slate-500 font-bold text-lg">₹</span>
                  </div>
                  <Input
                    value={partialAmount}
                    onChange={(e) => setPartialAmount(e.target.value.replace(/[^0-9]/g, ""))}
                    className="h-14 pl-10 text-lg font-bold bg-slate-50 border-slate-200 focus-visible:ring-2 rounded-xl transition-all"
                    style={{ '--tw-ring-color': STATIC_SUBSCRIPTION_COLOR }}
                    placeholder={`Max ₹${calc.selectedPlanBase}`}
                  />
                </div>
                <p className="text-xs text-slate-500 mt-2 font-medium">+ 18% GST will be added</p>
              </div>
            )}
          </section>
        )}

        {/* 4. Payment Summary */}
        {isPlanSelected && (
          <section className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <h3 className="text-lg font-bold text-slate-900 mb-5 flex items-center gap-2">
              <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              Payment Summary
            </h3>
            
            <div className="space-y-2 text-sm text-slate-600">
              {hasOnboardingFee && (
                <>
                  <div className="flex justify-between items-center"><span>Onboarding fee (Base)</span><span className="font-bold text-slate-900">₹{calc.onboardingFeeBase}</span></div>
                  <div className="flex justify-between items-center"><span>Onboarding GST (18%)</span><span className="font-bold text-slate-900">₹{calc.onboardingGST}</span></div>
                  <div className="flex justify-between items-center border-b border-slate-200 pb-3 mb-3">
                    <span className="font-semibold" style={{ color: STATIC_SUBSCRIPTION_COLOR }}>Onboarding Total</span>
                    <span className="font-bold text-slate-900">₹{calc.onboardingFeeTotal}</span>
                  </div>
                </>
              )}
              
              <div className="flex justify-between items-center"><span>Subscription ({String(plan || "starter").toUpperCase()} Plan) Base</span><span className="font-bold text-slate-900">₹{calc.selectedPlanBase}</span></div>
              <div className="flex justify-between items-center"><span>Subscription GST (18%)</span><span className="font-bold text-slate-900">₹{calc.selectedPlanGST}</span></div>
              <div className="flex justify-between items-center border-b border-slate-200 pb-3 mb-3">
                <span className="font-semibold" style={{ color: STATIC_SUBSCRIPTION_COLOR }}>Subscription Total</span>
                <span className="font-bold text-slate-900">₹{calc.subscriptionPlanTotal}</span>
              </div>

              <p className="text-xs font-bold tracking-wider pt-2 mb-2 uppercase" style={{ color: STATIC_SUBSCRIPTION_COLOR }}>BREAKDOWN OF PAY NOW</p>
              
              {hasOnboardingFee && (
                <div className="flex justify-between items-center"><span>Onboarding (Total)</span><span className="font-bold text-slate-900">₹{calc.onboardingFeeTotal}</span></div>
              )}
              <div className="flex justify-between items-center"><span>Subscription (Pay now) Base</span><span className="font-bold text-slate-900">₹{calc.subscriptionPaidNowBase}</span></div>
              <div className="flex justify-between items-center"><span>Subscription (Pay now) GST</span><span className="font-bold text-slate-900">₹{calc.subscriptionPaidNowGST}</span></div>
              
              <div className="pt-3 mt-3 border-t border-slate-200 border-dashed flex justify-between items-end">
                <span className="text-base font-bold" style={{ color: STATIC_SUBSCRIPTION_COLOR }}>Total to pay now</span>
                <span className="text-xl font-black tracking-tight" style={{ color: STATIC_SUBSCRIPTION_COLOR }}>₹{calc.payableNow}</span>
              </div>
              
              <div className="flex justify-between items-center pt-2">
                <span className="text-xs font-medium" style={{ color: STATIC_SUBSCRIPTION_COLOR }}>Remaining due later (inc. GST)</span>
                <span className="text-xs font-bold" style={{ color: STATIC_SUBSCRIPTION_COLOR }}>₹{calc.subscriptionDueLaterTotal}</span>
              </div>
            </div>
          </section>
        )}
      </main>

      {/* 5. Footer */}
      <footer className="bg-white border-t border-slate-200 p-4 pb-6 mt-auto">
        <div className="max-w-lg mx-auto flex items-center justify-between gap-3">
          <Button 
            variant="ghost" 
            className="h-14 flex-1 min-w-0 px-3 sm:px-4 rounded-2xl font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 active:scale-95 transition-all text-xs sm:text-sm" 
            onClick={handleBackToLogin}
          >
            Back to login screen
          </Button>
          <Button
            onClick={handleCreateOrder}
            disabled={processing || !calc}
            className="h-14 flex-1 min-w-0 px-3 sm:px-4 rounded-2xl font-bold text-white text-sm sm:text-base transition-all active:scale-100 disabled:opacity-70 disabled:active:scale-100 bg-black hover:bg-black/90 shadow-lg"
          >
            {processing ? (
              <span className="flex items-center justify-center gap-2 w-full">
                <svg className="animate-spin h-4 w-4 sm:h-5 sm:w-5 text-white shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                Processing...
              </span>
            ) : (
              calc.payableNow > 0 ? "Finish & Pay" : "Finish Setup"
            )}
          </Button>
        </div>
      </footer>
    </div>
  )
}
