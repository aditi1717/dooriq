import { useEffect, useRef, useState } from "react"
import { useNavigate, Link } from "react-router-dom"
import { ShieldCheck, Loader2, AlertCircle } from "lucide-react"
import { Button } from "@food/components/ui/button"
import { restaurantAPI } from "@food/api"
import { useCompanyName } from "@food/hooks/useCompanyName"
import { motion, AnimatePresence } from "framer-motion"

const DEFAULT_COUNTRY_CODE = "+91"

export default function RestaurantLogin() {
  const companyName = useCompanyName()
  const navigate = useNavigate()
  const phoneInputRef = useRef(null)
  const [formData, setFormData] = useState(() => {
    const saved = sessionStorage.getItem("restaurantLoginPhone")
    return {
      phone: saved || "",
      countryCode: DEFAULT_COUNTRY_CODE,
    }
  })
  const [error, setError] = useState("")
  const [isSending, setIsSending] = useState(false)
  const [keyboardInset, setKeyboardInset] = useState(0)

  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return undefined

    const updateKeyboardInset = () => {
      const viewport = window.visualViewport
      const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
      setKeyboardInset(inset > 0 ? inset : 0)
    }

    updateKeyboardInset()
    window.visualViewport.addEventListener("resize", updateKeyboardInset)
    window.visualViewport.addEventListener("scroll", updateKeyboardInset)

    return () => {
      window.visualViewport.removeEventListener("resize", updateKeyboardInset)
      window.visualViewport.removeEventListener("scroll", updateKeyboardInset)
    }
  }, [])

  const validatePhone = (phone) => {
    if (!phone || phone.trim() === "") return "Phone number required"
    const digitsOnly = phone.replace(/\D/g, "")
    if (digitsOnly.length !== 10) return "Must be 10 digits"
    if (!["6", "7", "8", "9"].includes(digitsOnly[0])) return "Invalid number"
    return ""
  }

  const handlePhoneChange = (e) => {
    const value = e.target.value.replace(/\D/g, "").slice(0, 10)
    setFormData((prev) => ({ ...prev, phone: value }))
    sessionStorage.setItem("restaurantLoginPhone", value)
    if (error) setError(validatePhone(value))
  }

  const handleSendOTP = async () => {
    const phoneError = validatePhone(formData.phone)
    if (phoneError) {
      setError(phoneError)
      return
    }

    const fullPhone = `${formData.countryCode} ${formData.phone}`.trim()

    try {
      setIsSending(true)
      await restaurantAPI.sendOTP(fullPhone, "login")
      sessionStorage.setItem("restaurantAuthData", JSON.stringify({
        method: "phone",
        phone: fullPhone,
        isSignUp: false,
        module: "restaurant",
      }))
      navigate("/food/restaurant/otp")
    } catch (apiErr) {
      setError(apiErr?.response?.data?.message || "Failed to send OTP")
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div className="min-h-[100dvh] bg-white dark:bg-[#0A0A0B] flex flex-col font-sans overflow-hidden">
      {/* Top Branding Section - 40% height */}
      <div className="relative h-[40dvh] w-full bg-[#FF5F00] overflow-hidden flex flex-col items-center justify-center">
        {/* Subtle Decorative Elements (No Blur) */}
        <div className="absolute inset-0 opacity-20">
          <div className="absolute -top-10 -right-10 w-64 h-64 border-8 border-white/10 rounded-full" />
          <div className="absolute bottom-10 -left-10 w-48 h-48 border-4 border-white/5 rounded-full" />
        </div>

        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="relative z-10 flex flex-col items-center gap-4"
        >
          <div className="w-20 h-20 bg-white rounded-3xl flex items-center justify-center shadow-2xl border-4 border-white/20 transform rotate-6">
            <ShieldCheck className="w-10 h-10 text-[#FF5F00] -rotate-6" />
          </div>
          <div className="text-center text-white">
            <h1 className="font-black text-3xl tracking-tight leading-none mb-1">
              {companyName.toUpperCase()}<span className="opacity-60 italic">PARTNER</span>
            </h1>
            <div className="h-0.5 w-10 bg-white/40 mx-auto rounded-full" />
          </div>
        </motion.div>
      </div>

      {/* Bottom Form Section - 60% height */}
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        className="flex-1 bg-white dark:bg-[#0A0A0B] rounded-t-[40px] -mt-12 relative z-20 shadow-[0_-20px_40px_rgba(0,0,0,0.05)] px-6 pt-12 pb-6 flex flex-col"
        style={{ marginBottom: keyboardInset ? `${keyboardInset}px` : 0 }}
      >
        <div className="max-w-md mx-auto w-full flex flex-col h-full">
          <div className="space-y-2 mb-10">
            <h2 className="text-2xl font-black text-zinc-900 dark:text-white tracking-tight">
              Restaurant Portal
            </h2>
            <p className="text-sm font-medium text-zinc-500 dark:text-zinc-500">
              Signin with your registered mobile to manage your outlet.
            </p>
          </div>

          <div className="space-y-8">
            <div className="space-y-4">
              <label className="text-[10px] font-black text-zinc-400 dark:text-zinc-600 uppercase tracking-[0.3em] ml-1">
                Owner Contact Number
              </label>
              
              <div className="flex items-center gap-0 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl focus-within:border-[#FF5F00]/50 focus-within:ring-4 focus-within:ring-[#FF5F00]/5 transition-all overflow-hidden">
                <div className="flex items-center px-4 h-16 bg-zinc-50 dark:bg-zinc-800/50 text-zinc-900 dark:text-white font-black text-xl border-r border-zinc-200 dark:border-zinc-800">
                  <span>+91</span>
                </div>
                <input
                  ref={phoneInputRef}
                  type="tel"
                  maxLength={10}
                  inputMode="numeric"
                  placeholder="00000 00000"
                  value={formData.phone}
                  onChange={handlePhoneChange}
                  className="flex-1 h-16 bg-transparent border-0 outline-none ring-0 placeholder:text-zinc-300 dark:placeholder:text-zinc-700 text-lg font-black tracking-widest px-5 text-zinc-900 dark:text-white"
                />
              </div>

              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    className="flex items-center gap-1.5 text-xs font-bold text-[#FF5F00] pl-2"
                  >
                    <AlertCircle className="h-4 w-4" />
                    <span>{error}</span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <Button
              onClick={handleSendOTP}
              disabled={isSending || formData.phone.length !== 10}
              className="w-full h-16 rounded-2xl font-black text-base tracking-widest uppercase transition-all duration-300 bg-[#FF5F00] hover:bg-[#E05400] text-white shadow-[0_12px_24px_rgba(255,95,0,0.3)] active:scale-[0.98] disabled:opacity-50 disabled:grayscale"
            >
              {isSending ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>Authorizing...</span>
                </div>
              ) : (
                "Continue Securely"
              )}
            </Button>
          </div>

          <footer className="mt-auto pt-10 text-center">
            <p className="text-[10px] text-zinc-400 dark:text-zinc-600 font-medium leading-relaxed uppercase tracking-wide">
              Secure partner login powered by<br />
              <span className="text-[#FF5F00] font-black">{companyName} Network</span>
            </p>
            <p className="text-[10px] text-zinc-300 dark:text-zinc-700 font-bold mt-2 uppercase tracking-widest">
              <Link to="/food/restaurant/terms" className="hover:text-[#FF5F00]">Terms</Link> • <Link to="/food/restaurant/privacy" className="hover:text-[#FF5F00]">Privacy</Link> • <Link to="/food/restaurant/help-content" className="hover:text-[#FF5F00]">Support</Link>
            </p>
          </footer>
        </div>
      </motion.div>
    </div>
  )
}
