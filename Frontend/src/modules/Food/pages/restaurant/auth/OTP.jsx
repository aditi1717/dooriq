import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeft, ShieldCheck, Timer, RefreshCw, AlertCircle } from "lucide-react"
import { Button } from "@food/components/ui/button"
import { restaurantAPI } from "@food/api"
import {
  setAuthData as setRestaurantAuthData,
  setRestaurantPendingPhone,
} from "@food/utils/auth"
import { useCompanyName } from "@food/hooks/useCompanyName"
import { motion, AnimatePresence } from "framer-motion"

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
      const needsRegistration = data?.needsRegistration === true
      const normalizedPhone = data?.phone || phone

      if (needsRegistration) {
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
            // Fail-safe: avoid payment screen flash when feature endpoint is throttled/unavailable
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
    <div className="min-h-[100dvh] bg-white dark:bg-[#0A0A0B] flex flex-col font-sans overflow-hidden">
      {/* Top Branding Section - 35% height */}
      <div className="relative h-[35dvh] w-full bg-[#FF5F00] overflow-hidden flex flex-col items-center justify-center">
        <div className="absolute inset-0 opacity-20">
          <div className="absolute top-0 left-0 w-64 h-64 border border-white/20 rounded-full -ml-20 -mt-20" />
          <div className="absolute bottom-10 right-0 w-32 h-32 border border-white/10 rounded-full -mr-16" />
        </div>

        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.6 }}
          className="relative z-10 flex flex-col items-center gap-4 px-6 text-center"
        >
          <div className="w-16 h-16 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center border border-white/30 shadow-lg mb-2">
            <ShieldCheck className="w-8 h-8 text-white" />
          </div>
          <div className="space-y-1">
            <h1 className="text-white font-black text-3xl tracking-tight leading-none italic">
              SECURITY CHECK
            </h1>
            <p className="text-white/70 text-xs font-bold uppercase tracking-[0.2em]">
              Sent to {contactInfo}
            </p>
          </div>
        </motion.div>
      </div>

      {/* Bottom Content Section - 65% height */}
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        className="flex-1 bg-white dark:bg-[#0A0A0B] rounded-t-[40px] -mt-10 relative z-20 shadow-[0_-20px_40px_rgba(0,0,0,0.05)] px-6 pt-12 pb-6 flex flex-col"
        style={{ marginBottom: keyboardOffset > 0 ? `${keyboardOffset}px` : 0 }}
      >
        <div className="max-w-md mx-auto w-full flex flex-col h-full">
          <div className="space-y-10">
            <div ref={otpSectionRef} className="flex justify-center gap-4">
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
                    className={`w-16 h-20 text-center text-3xl font-black bg-zinc-100 dark:bg-zinc-900 border-2 rounded-2xl text-zinc-900 dark:text-white transition-all outline-none shadow-sm ${
                      focusedIndex === index ? "border-[#FF5F00] shadow-[#FF5F00]/10" : "border-transparent"
                    }`}
                  />
                  {digit && (
                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-[#FF5F00] rounded-full" />
                  )}
                </motion.div>
              ))}
            </div>

            {error && (
              <motion.div
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center justify-center gap-2 text-xs font-bold text-[#FF5F00] bg-[#FF5F00]/5 py-4 px-4 rounded-2xl border border-[#FF5F00]/10"
              >
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </motion.div>
            )}

            <div className="space-y-6 pt-4">
              <Button
                onClick={() => handleVerify()}
                disabled={isLoading || otp.some(d => !d)}
                className="w-full h-16 bg-[#FF5F00] hover:bg-[#E05400] text-white font-black text-base uppercase tracking-widest rounded-2xl transition-all duration-300 shadow-[0_12px_24px_rgba(255,95,0,0.3)] active:scale-[0.98] disabled:opacity-50 disabled:grayscale"
              >
                {isLoading ? (
                  <div className="flex items-center gap-2">
                    <RefreshCw className="h-5 w-5 animate-spin" />
                    <span>Validating...</span>
                  </div>
                ) : (
                  "Unlock Portal"
                )}
              </Button>

              <div className="flex justify-center flex-col items-center gap-4">
                {resendTimer > 0 ? (
                  <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">
                    Request new code in <span className="text-[#FF5F00]">{resendTimer}s</span>
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={isLoading}
                    className="text-xs font-black text-[#FF5F00] uppercase tracking-[0.2em] px-6 py-2 rounded-full bg-[#FF5F00]/5 hover:bg-[#FF5F00]/10 transition-colors"
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

          <footer className="mt-auto pt-10 text-center">
            <p className="text-[9px] text-zinc-300 dark:text-zinc-700 font-black uppercase tracking-[0.4em]">
              Partner Security Network &bull; {companyName.toUpperCase()}
            </p>
          </footer>
        </div>
      </motion.div>
    </div>
  )
}
