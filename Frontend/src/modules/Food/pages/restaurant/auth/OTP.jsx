import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeft, ShieldCheck, Timer, RefreshCw, AlertCircle } from "lucide-react"
import { Button } from "@food/components/ui/button"
import { restaurantAPI } from "@food/api"
import {
  setAuthData as setRestaurantAuthData,
  setRestaurantPendingPhone,
  clearRestaurantSessionCache,
} from "@food/utils/auth"
import { useCompanyName } from "@food/hooks/useCompanyName"
import { motion, AnimatePresence } from "framer-motion"
import { getCachedSettings, getModuleLogoUrl, loadBusinessSettings } from "@food/utils/businessSettings"

export default function RestaurantOTP() {
  const companyName = useCompanyName()
  const navigate = useNavigate()
  const [otp, setOtp] = useState(["", "", "", ""])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const [resendTimer, setResendTimer] = useState(0)
  const [authData, setAuthData] = useState(null)
  const [contactInfo, setContactInfo] = useState("") 
  const [focusedIndex, setFocusedIndex] = useState(null)
  const [keyboardOffset, setKeyboardOffset] = useState(0)
  const inputRefs = useRef([])
  const hasSubmittedRef = useRef(false)
  const otpSectionRef = useRef(null)
  const [logoUrl, setLogoUrl] = useState(() => getModuleLogoUrl("restaurant") || null)

  useEffect(() => {
    const syncLogo = () => {
      const resolvedLogo = getModuleLogoUrl("restaurant")
      if (resolvedLogo) setLogoUrl(resolvedLogo)
    }

    const loadLogo = async () => {
      try {
        if (!getCachedSettings()) {
          await loadBusinessSettings()
        }
        syncLogo()
      } catch (err) {
        console.error("Error loading restaurant OTP logo:", err)
      }
    }

    loadLogo()
    window.addEventListener("businessSettingsUpdated", syncLogo)
    return () => window.removeEventListener("businessSettingsUpdated", syncLogo)
  }, [])

  useEffect(() => {
    const stored = sessionStorage.getItem("restaurantAuthData")
    if (stored) {
      const data = JSON.parse(stored)
      setAuthData(data)
      if (data.method === "email" && data.email) {
        setContactInfo(data.email)
      } else if (data.phone) {
        const phoneMatch = data.phone?.match(/(\+\d+)\s*(.+)/)
        setContactInfo(phoneMatch ? `${phoneMatch[1]} ${phoneMatch[2].replace(/\D/g, "")}` : (data.phone || ""))
      }
    } else {
      navigate("/food/restaurant/login")
      return
    }

    setResendTimer(60)
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return
      setResendTimer((prev) => {
        if (prev <= 1) {
          clearInterval(timer)
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [navigate])

  useEffect(() => {
    if (inputRefs.current[0]) inputRefs.current[0].focus()
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    const viewport = window.visualViewport
    if (!viewport) return
    const updateKeyboardState = () => {
      const keyboardHeight = Math.max(0, window.innerHeight - viewport.height)
      setKeyboardOffset(keyboardHeight > 120 ? keyboardHeight : 0)
    }
    updateKeyboardState()
    viewport.addEventListener("resize", updateKeyboardState)
    viewport.addEventListener("scroll", updateKeyboardState)
    return () => {
      viewport.removeEventListener("resize", updateKeyboardState)
      viewport.removeEventListener("scroll", updateKeyboardState)
    }
  }, [])

  const handleChange = (index, value) => {
    if (value && !/^\d$/.test(value)) return
    const newOtp = [...otp]
    newOtp[index] = value
    setOtp(newOtp)
    setError("")

    if (value && index < 3) {
      inputRefs.current[index + 1]?.focus()
    }

    if (newOtp.every((digit) => digit !== "") && newOtp.length === 4) {
      if (!hasSubmittedRef.current) {
        hasSubmittedRef.current = true
        handleVerify(newOtp.join(""))
      }
    }
  }

  const handleKeyDown = (index, e) => {
    if (e.key === "Backspace") {
      if (otp[index]) {
        const newOtp = [...otp]
        newOtp[index] = ""
        setOtp(newOtp)
      } else if (index > 0) {
        inputRefs.current[index - 1]?.focus()
        const newOtp = [...otp]
        newOtp[index - 1] = ""
        setOtp(newOtp)
      }
    }
  }

  const handlePaste = (e) => {
    e.preventDefault()
    const pastedData = e.clipboardData.getData("text")
    const digits = pastedData.replace(/\D/g, "").slice(0, 4).split("")
    const newOtp = [...otp]
    digits.forEach((digit, i) => { if (i < 4) newOtp[i] = digit })
    setOtp(newOtp)
    if (digits.length === 4) handleVerify(newOtp.join(""))
    else inputRefs.current[digits.length]?.focus()
  }

  const handleVerify = async (otpValue = null) => {
    const code = otpValue || otp.join("")
    if (hasSubmittedRef.current && !otpValue) return
    if (code.length !== 4) {
      setError("Please enter the complete 4-digit code")
      hasSubmittedRef.current = false
      return
    }

    setIsLoading(true)
    setError("")

    try {
      if (!authData) throw new Error("Session expired.")
      const phone = authData.method === "phone" ? authData.phone : null
      const email = authData.method === "email" ? authData.email : null
      const purpose = authData.isSignUp ? "register" : "login"

      const response = await restaurantAPI.verifyOTP(phone, code, purpose, null, email)
      const data = response?.data?.data || response?.data
      
      const hasRestaurantProfile = Boolean(data?.restaurant || (data?.user && (data?.user?.role === 'restaurant' || data?.user?.restaurantName || data?.user?.ownerPhone)))
      const needsRegistration = data?.needsRegistration === true || !hasRestaurantProfile
      const normalizedPhone = data?.phone || phone

      if (needsRegistration) {
        clearRestaurantSessionCache()
        setRestaurantPendingPhone(normalizedPhone)
        sessionStorage.removeItem("restaurantAuthData")
        sessionStorage.removeItem("restaurantLoginPhone")
        navigate("/food/restaurant/onboarding", { replace: true })
        return
      }

      const accessToken = data?.accessToken
      const refreshToken = data?.refreshToken ?? null
      const restaurant = data?.user ?? data?.restaurant
      const paymentRequired = data?.paymentRequired === true

      if (accessToken && restaurant) {
        let shouldGoToOnboardingPayment = paymentRequired

        if (paymentRequired) {
          let isSubscriptionEnabled = true
          try {
            const featureRes = await restaurantAPI.getFeatureSettingsPublic()
            const rows = Array.isArray(featureRes?.data?.data) ? featureRes.data.data : []
            const feature = rows.find((row) => row.key === "restaurant_subscription")
            isSubscriptionEnabled = feature ? Boolean(feature.isEnabled) : true
            localStorage.setItem("restaurant_subscription_feature_enabled", String(isSubscriptionEnabled))
          } catch (_error) {
            isSubscriptionEnabled = false
            localStorage.setItem("restaurant_subscription_feature_enabled", "false")
          }
          shouldGoToOnboardingPayment = isSubscriptionEnabled
        }

        setRestaurantAuthData("restaurant", accessToken, restaurant, refreshToken)
        window.dispatchEvent(new Event("restaurantAuthChanged"))
        sessionStorage.removeItem("restaurantAuthData")
        sessionStorage.removeItem("restaurantLoginPhone")

        if (shouldGoToOnboardingPayment) {
          navigate("/food/restaurant/onboarding-payment", { replace: true })
          return
        }

        if (authData?.isSignUp) {
          navigate("/food/restaurant", { replace: true })
        } else {
          try {
            navigate("/food/restaurant", { replace: true })
          } catch (err) { navigate("/food/restaurant", { replace: true }) }
        }
      }
    } catch (err) {
      const message = err?.response?.data?.message || err?.response?.data?.error || err?.message || "Invalid OTP."
      if (/pending approval/i.test(message)) {
        const pendingPhone = authData?.phone || authData?.email || contactInfo
        if (pendingPhone) setRestaurantPendingPhone(pendingPhone)
        sessionStorage.removeItem("restaurantAuthData")
        sessionStorage.removeItem("restaurantLoginPhone")
        navigate("/food/restaurant/pending-verification", {
          replace: true, state: { phone: pendingPhone || "" },
        })
        return
      }
      setError(message)
      setOtp(["", "", "", ""])
      hasSubmittedRef.current = false
      inputRefs.current[0]?.focus()
    } finally { setIsLoading(false) }
  }

  const handleResend = async () => {
    if (resendTimer > 0) return
    setIsLoading(true)
    setError("")
    try {
      if (!authData) throw new Error("Session expired.")
      const purpose = authData.isSignUp ? "register" : "login"
      const phone = authData.method === "phone" ? authData.phone : null
      const email = authData.method === "email" ? authData.email : null
      await restaurantAPI.sendOTP(phone, purpose, email)
      setResendTimer(60)
    } catch (err) { setError("Failed to resend OTP.") }
    setIsLoading(false)
    setOtp(["", "", "", ""])
    inputRefs.current[0]?.focus()
  }

  if (!authData) return null

  return (
    <div className="min-h-[100dvh] bg-slate-50 dark:bg-[#09090B] flex items-center justify-center font-sans p-4 sm:p-6">
      {/* Compact Center Card */}
      <div className="w-full max-w-[420px] bg-white dark:bg-[#0A0A0B] rounded-[2.5rem] shadow-[0_24px_70px_rgba(0,0,0,0.06)] border border-zinc-100 dark:border-zinc-800/50 flex flex-col overflow-hidden relative">
        
        {/* Top Branding Section */}
        <div 
          className="relative w-full overflow-hidden flex flex-col items-center justify-center min-h-[170px]"
          style={{ 
            background: "linear-gradient(135deg, rgba(var(--module-theme-rgb, 37,99,235), 0.94) 0%, var(--module-theme-color, #2563EB) 55%, rgba(var(--module-theme-rgb, 37,99,235), 0.82) 100%)" 
          }}
        >
          <div className="absolute inset-0 opacity-20">
            <div className="absolute top-0 left-0 w-64 h-64 border border-white/20 rounded-full -ml-20 -mt-20" />
            <div className="absolute bottom-10 right-0 w-32 h-32 border border-white/10 rounded-full -mr-16" />
          </div>

          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.6 }}
            className="relative z-10 flex flex-col items-center gap-3 px-6 text-center"
          >
            {logoUrl ? (
              <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center shadow-lg border border-white/10 overflow-hidden p-2">
                <img src={logoUrl} alt="logo" className="w-full h-full object-contain" />
              </div>
            ) : (
              <div className="w-16 h-16 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center border border-white/30 shadow-lg mb-2">
                <ShieldCheck className="w-8 h-8 text-white" />
              </div>
            )}
            <div className="space-y-1">
              <h1 className="text-white font-black text-2xl tracking-tight leading-none italic">
                SECURITY CHECK
              </h1>
              <p className="text-white/70 text-[10px] font-bold uppercase tracking-[0.2em]">
                Sent to {contactInfo}
              </p>
            </div>
          </motion.div>
        </div>

        {/* Bottom Content Section */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="p-8 flex flex-col gap-6"
        >
          <div className="w-full flex flex-col justify-center gap-6">
            <div ref={otpSectionRef} className="flex justify-center gap-3">
              {otp.map((digit, index) => (
                <motion.div
                  key={index}
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.1 * index }}
                  className="relative"
                >
                  <input
                    ref={(el) => (inputRefs.current[index] = el)}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleChange(index, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(index, e)}
                    onPaste={handlePaste}
                    onFocus={() => setFocusedIndex(index)}
                    onBlur={() => setFocusedIndex(null)}
                    disabled={isLoading}
                    className={`w-12 h-16 text-center text-2xl font-black bg-zinc-100 dark:bg-zinc-900 border-2 rounded-xl text-zinc-900 dark:text-white transition-all outline-none shadow-sm ${
                      focusedIndex === index ? "border-primary" : "border-transparent"
                    }`}
                  />
                  {digit && (
                    <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-primary rounded-full" />
                  )}
                </motion.div>
              ))}
            </div>

            {error && (
              <motion.div
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center justify-center gap-2 text-xs font-bold text-primary bg-primary/5 py-3 px-4 rounded-xl border border-primary/10"
              >
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </motion.div>
            )}

            <div className="space-y-6">
              <Button
                onClick={() => handleVerify()}
                disabled={isLoading || otp.some(d => !d)}
                className="w-full h-12 bg-primary hover:opacity-90 text-white font-black text-sm uppercase tracking-widest rounded-xl transition-all duration-300 active:scale-[0.98] disabled:opacity-50 disabled:grayscale"
                style={{ 
                  boxShadow: "0 8px 16px rgba(var(--module-theme-rgb, 37,99,235), 0.2)" 
                }}
              >
                {isLoading ? (
                  <div className="flex items-center gap-2 justify-center w-full">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>Validating...</span>
                  </div>
                ) : (
                  "Unlock Portal"
                )}
              </Button>

              <div className="flex justify-center flex-col items-center gap-4">
                {resendTimer > 0 ? (
                  <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">
                    Request new code in <span className="text-primary">{resendTimer}s</span>
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={isLoading}
                    className="text-xs font-black text-primary uppercase tracking-[0.2em] px-6 py-2 rounded-full bg-primary/5 hover:bg-primary/10 transition-colors"
                  >
                    Resend OTP
                  </button>
                )}

                <Button
                  onClick={() => navigate("/food/restaurant/login")}
                  variant="ghost"
                  className="text-zinc-400 dark:text-zinc-600 font-bold text-[10px] uppercase tracking-widest hover:bg-transparent hover:text-zinc-900"
                >
                  Change Account
                </Button>
              </div>
            </div>
          </div>

          <footer className="text-center pt-2">
            <p className="text-[9px] text-zinc-300 dark:text-zinc-700 font-black uppercase tracking-[0.4em]">
              Partner Security Network &bull; {companyName.toUpperCase()}
            </p>
          </footer>
        </motion.div>
      </div>
    </div>
  )
}
