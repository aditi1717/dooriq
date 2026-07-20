import { useState, useEffect, useRef } from "react"
import { useNavigate, Link, useSearchParams } from "react-router-dom"
import { deliveryAPI } from "@food/api"
import { clearModuleAuth } from "@food/utils/auth"
import { useCompanyName } from "@food/hooks/useCompanyName"
import { motion, AnimatePresence } from "framer-motion"
import { Bike, Loader2, AlertCircle } from "lucide-react"
import { Button } from "@food/components/ui/button"
import { getCachedSettings, getModuleLogoUrl, loadBusinessSettings } from "@food/utils/businessSettings"

export default function DeliverySignIn() {
  const companyName = useCompanyName()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const phoneInputRef = useRef(null)

  useEffect(() => {
    const ref = String(searchParams.get("ref") || "").trim()
    if (ref) {
      localStorage.setItem("food_delivery_invite_ref", ref)
    }
  }, [searchParams])
  const [formData, setFormData] = useState({
    phone: "",
    countryCode: "+91",
  })
  const [error, setError] = useState("")
  const [isSending, setIsSending] = useState(false)
  const [logoUrl, setLogoUrl] = useState(() => getModuleLogoUrl("delivery") || null)

  useEffect(() => {
    const draftPhone = sessionStorage.getItem("deliveryDraftPhone")
    if (draftPhone) {
      setFormData(prev => ({ ...prev, phone: draftPhone }))
      return
    }

    const stored = sessionStorage.getItem("deliveryAuthData")
    if (stored) {
      try {
        const data = JSON.parse(stored)
        if (data.phone) {
          const phoneDigits = data.phone.replace("+91", "").trim()
          setFormData(prev => ({ ...prev, phone: phoneDigits }))
        }
      } catch (err) { }
    }
  }, [])

  useEffect(() => {
    const syncLogo = () => {
      const resolvedLogo = getModuleLogoUrl("delivery")
      if (resolvedLogo) setLogoUrl(resolvedLogo)
    }

    const loadLogo = async () => {
      try {
        if (!getCachedSettings()) {
          await loadBusinessSettings()
        }
        syncLogo()
      } catch (err) {
        console.error("Error loading delivery login logo:", err)
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

  const handleSendOTP = async () => {
    setError("")
    const phoneError = validatePhone(formData.phone)
    if (phoneError) {
      setError(phoneError)
      return
    }

    const fullPhone = `${formData.countryCode} ${formData.phone}`.trim()

    try {
      setIsSending(true)
      clearModuleAuth("delivery")
      await deliveryAPI.sendOTP(fullPhone, "login")
      const ref = String(searchParams.get("ref") || "").trim() || localStorage.getItem("food_delivery_invite_ref") || ""
      sessionStorage.setItem("deliveryAuthData", JSON.stringify({
        method: "phone",
        phone: fullPhone,
        isSignUp: false,
        purpose: "login",
        module: "delivery",
        referralCode: ref || null,
      }))
      sessionStorage.removeItem("deliveryDraftPhone")
      navigate("/food/delivery/otp")
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to send OTP")
    } finally {
      setIsSending(false)
    }
  }

  const handlePhoneChange = (e) => {
    const value = e.target.value.replace(/\D/g, "").slice(0, 10)
    setFormData(prev => ({ ...prev, phone: value }))
    sessionStorage.setItem("deliveryDraftPhone", value)
    if (error) setError(validatePhone(value))
  }

  return (
    <div className="min-h-[100dvh] bg-slate-50 dark:bg-[#09090B] flex items-center justify-center font-sans p-4 sm:p-6">
      {/* Compact Center Card */}
      <div className="w-full max-w-[420px] bg-white dark:bg-[#0A0A0B] rounded-[2.5rem] shadow-[0_24px_70px_rgba(0,0,0,0.06)] border border-zinc-100 dark:border-zinc-800/50 flex flex-col overflow-hidden relative">
        
        {/* Top Branding Section */}
        <div className="relative w-full bg-[#00B761] py-8 overflow-hidden flex flex-col items-center justify-center min-h-[170px]">
          {/* Subtle Decorative Elements (No Blur) */}
          <div className="absolute inset-0 opacity-20">
            <div className="absolute top-0 right-0 w-64 h-64 border border-white/20 rounded-full -mr-20 -mt-20" />
            <div className="absolute bottom-0 left-0 w-48 h-48 border border-white/10 rounded-full -ml-16 -mb-16" />
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
              <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center shadow-lg transform -rotate-12 border-2 border-white/30 p-2">
                <Bike className="w-8 h-8 text-[#00B761] rotate-12" />
              </div>
            )}
            <div className="text-center text-white">
              <h1 className="font-black text-2xl tracking-tighter leading-none mb-1 italic">
                {companyName.toUpperCase()} <span className="opacity-60">CAPTAIN</span>
              </h1>
              <div className="bg-black/10 px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest inline-block">
                Delivery Partner
              </div>
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
              Start your shift
            </h2>
            <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Enter your mobile number to sign in as a captain.
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-[9px] font-black text-zinc-400 dark:text-zinc-600 uppercase tracking-[0.25em] block text-center">
                Linked Identity
              </label>

              <div className="flex items-center gap-0 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl focus-within:border-[color:var(--module-theme-color)] focus-within:ring-4 focus-within:ring-[rgba(var(--module-theme-rgb),0.12)] transition-all overflow-hidden h-12">
                <div className="px-4 border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 text-zinc-900 dark:text-white font-black text-base h-full flex items-center">
                  +91
                </div>
                <input
                  ref={phoneInputRef}
                  type="tel"
                  maxLength={10}
                  inputMode="numeric"
                  placeholder="Mobile Number"
                  value={formData.phone}
                  onChange={handlePhoneChange}
                  className="flex-1 bg-transparent border-0 outline-none ring-0 placeholder:text-zinc-300 dark:placeholder:text-zinc-700 text-base font-black tracking-widest px-4 text-zinc-900 dark:text-white h-full text-left"
                />
              </div>

              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    className="flex items-center justify-center gap-1.5 text-xs font-bold text-[#00B761] text-center animate-pulse"
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
              className="w-full h-12 rounded-xl font-black text-sm tracking-widest uppercase transition-all duration-300 bg-[#00B761] hover:bg-[#009049] text-white shadow-[0_8px_16px_rgba(0,183,97,0.2)] active:scale-[0.98] disabled:opacity-50 disabled:grayscale"
            >
              {isSending ? (
                <div className="flex items-center gap-2 justify-center w-full">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Checking...</span>
                </div>
              ) : (
                "Go Online"
              )}
            </Button>
          </div>

          <footer className="text-center pt-2">
            <p className="text-[9px] text-zinc-400 dark:text-zinc-600 font-medium tracking-wide uppercase">
              By joining, you agree to our policies
            </p>
            <p className="text-[9px] text-zinc-300 dark:text-zinc-700 font-bold mt-1.5 uppercase tracking-widest">
              <Link to="/food/delivery/terms" state={{ from: "/food/delivery/login" }} className="hover:text-[#00B761]">Terms</Link> • <Link to="/food/delivery/profile/privacy" state={{ from: "/food/delivery/login" }} className="hover:text-[#00B761]">Privacy</Link> • <Link to="/food/delivery/help/content" state={{ from: "/food/delivery/login" }} className="hover:text-[#00B761]">Support</Link>
            </p>
          </footer>
        </motion.div>
      </div>
    </div>
  )
}
