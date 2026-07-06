import { useEffect, useRef, useState } from "react"
import { useNavigate, Link } from "react-router-dom"
import { ShieldCheck, Loader2, AlertCircle } from "lucide-react"
import { Button } from "@food/components/ui/button"
import { restaurantAPI } from "@food/api"
import { useCompanyName } from "@food/hooks/useCompanyName"
import { motion, AnimatePresence } from "framer-motion"
import { getCachedSettings, getModuleLogoUrl, loadBusinessSettings } from "@food/utils/businessSettings"

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
        console.error("Error loading restaurant login logo:", err)
      }
    }

    loadLogo()
    window.addEventListener("businessSettingsUpdated", syncLogo)
    return () => window.removeEventListener("businessSettingsUpdated", syncLogo)
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
          {/* Subtle Decorative Elements (No Blur) */}
          <div className="absolute inset-0 opacity-20">
            <div className="absolute -top-10 -right-10 w-64 h-64 border-8 border-white/10 rounded-full" />
            <div className="absolute bottom-10 -left-10 w-48 h-48 border-4 border-white/5 rounded-full" />
          </div>

          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="relative z-10 flex flex-col items-center gap-3"
          >
            {logoUrl ? (
              <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center shadow-lg border border-white/10 overflow-hidden p-2">
                <img src={logoUrl} alt="logo" className="w-full h-full object-contain" />
              </div>
            ) : (
              <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center shadow-lg border-2 border-white/30 transform rotate-6 p-2">
                <ShieldCheck className="w-8 h-8 text-primary -rotate-6" />
              </div>
            )}
            <div className="text-center text-white">
              <h1 className="font-black text-2xl tracking-tighter leading-none mb-1">
                {companyName.toUpperCase()}<span className="opacity-60 italic">PARTNER</span>
              </h1>
              <div className="h-0.5 w-10 bg-white/40 mx-auto rounded-full" />
            </div>
          </motion.div>
        </div>

        {/* Bottom Form Section */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="p-8 flex flex-col gap-6"
        >
          <div className="space-y-1 text-center">
            <h2 className="text-xl font-black text-zinc-900 dark:text-white tracking-tight">
              Restaurant Portal
            </h2>
            <p className="text-xs font-medium text-zinc-500 dark:text-zinc-500">
              Signin with your registered mobile to manage your outlet.
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-[9px] font-black text-zinc-400 dark:text-zinc-600 uppercase tracking-[0.25em] block text-center">
                Owner Contact Number
              </label>
              
              <div className="flex items-center gap-0 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10 transition-all overflow-hidden h-12">
                <div className="flex items-center px-4 h-full bg-zinc-50 dark:bg-zinc-800/50 text-zinc-900 dark:text-white font-black text-base border-r border-zinc-200 dark:border-zinc-800">
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
                  className="flex-1 bg-transparent border-0 outline-none ring-0 placeholder:text-zinc-300 dark:placeholder:text-zinc-700 text-base font-black tracking-widest px-4 text-zinc-900 dark:text-white text-center"
                />
              </div>

              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    className="flex items-center justify-center gap-1.5 text-xs font-bold text-primary text-center animate-pulse"
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
              className="w-full h-12 rounded-xl font-black text-sm tracking-widest uppercase transition-all duration-300 bg-primary hover:opacity-90 text-white active:scale-[0.98] disabled:opacity-50 disabled:grayscale"
              style={{ 
                boxShadow: "0 8px 16px rgba(var(--module-theme-rgb, 37,99,235), 0.2)" 
              }}
            >
              {isSending ? (
                <div className="flex items-center gap-2 justify-center w-full">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Authorizing...</span>
                </div>
              ) : (
                "Continue Securely"
              )}
            </Button>
          </div>

          <footer className="text-center pt-2">
            <p className="text-[9px] text-zinc-400 dark:text-zinc-600 font-medium leading-relaxed uppercase tracking-wide">
              Secure partner login powered by<br />
              <span className="text-primary font-black">{companyName} Network</span>
            </p>
            <p className="text-[9px] text-zinc-300 dark:text-zinc-700 font-bold mt-2 uppercase tracking-widest">
              <Link to="/food/restaurant/terms" className="hover:text-primary">Terms</Link> • <Link to="/food/restaurant/privacy" className="hover:text-primary">Privacy</Link> • <Link to="/food/restaurant/help-content" className="hover:text-primary">Support</Link>
            </p>
          </footer>
        </motion.div>
      </div>
    </div>
  )
}
