import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeft, Loader2, Timer, RefreshCw, AlertCircle, ShieldCheck, User } from "lucide-react"
import { Input } from "@food/components/ui/input"
import { Button } from "@food/components/ui/button"
import { deliveryAPI } from "@food/api"
import { setAuthData as storeAuthData } from "@food/utils/auth"
import { useCompanyName } from "@food/hooks/useCompanyName"
import { motion, AnimatePresence } from "framer-motion"
import { getCachedSettings, getModuleLogoUrl, loadBusinessSettings } from "@food/utils/businessSettings"
import { useDeliveryOnboardingStore } from "../../store/useDeliveryOnboardingStore"

export default function DeliveryOTP() {
  const companyName = useCompanyName()
  const navigate = useNavigate()
  const [otp, setOtp] = useState(["", "", "", ""])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const [resendTimer, setResendTimer] = useState(0)
  const [authData, setAuthData] = useState(null)
  const [showNameInput, setShowNameInput] = useState(false)
  const [name, setName] = useState("")
  const [nameError, setNameError] = useState("")
  const [verifiedOtp, setVerifiedOtp] = useState("")
  const [pendingMessage, setPendingMessage] = useState("")
  const [isRejected, setIsRejected] = useState(false)
  const [rejectionReason, setRejectionReason] = useState("")
  const [deviceToken, setDeviceToken] = useState(null)
  const [activePlatform, setActivePlatform] = useState("web")
  const [focusedIndex, setFocusedIndex] = useState(0)
  const [keyboardOffset, setKeyboardOffset] = useState(0)
  const inputRefs = useRef([])
  const [logoUrl, setLogoUrl] = useState(() => getModuleLogoUrl("delivery") || null)

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
        console.error("Error loading delivery OTP logo:", err)
      }
    }

    loadLogo()
    window.addEventListener("businessSettingsUpdated", syncLogo)
    return () => window.removeEventListener("businessSettingsUpdated", syncLogo)
  }, [])

  useEffect(() => {
    const stored = sessionStorage.getItem("deliveryAuthData")
    if (stored) {
      setAuthData(JSON.parse(stored))
    } else {
      const token = localStorage.getItem("delivery_accessToken")
      const authenticated = localStorage.getItem("delivery_authenticated") === "true"
      if (token && authenticated) {
        try {
          const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
          if (payload.exp > Math.floor(Date.now() / 1000)) {
            navigate("/food/delivery", { replace: true })
            return
          }
        } catch (e) {}
      }
      navigate("/food/delivery/login", { replace: true })
      return
    }

    setResendTimer(60)
    const timer = setInterval(() => {
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

  useEffect(() => {
    if (inputRefs.current[0] && otp.every(digit => digit === "")) {
      setTimeout(() => inputRefs.current[0]?.focus(), 100)
    }
  }, [otp])

  const handleChange = (index, value) => {
    if (value && !/^\d$/.test(value)) return
    const newOtp = [...otp]
    newOtp[index] = value
    setOtp(newOtp)
    setError("")
    if (value && index < 3) inputRefs.current[index + 1]?.focus()
    if (!showNameInput && newOtp.every((digit) => digit !== "") && newOtp.length === 4) {
      handleVerify(newOtp.join(""))
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
    const digits = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 4).split("")
    const newOtp = [...otp]
    digits.forEach((digit, i) => { if (i < 4) newOtp[i] = digit })
    setOtp(newOtp)
    if (!showNameInput && digits.length === 4) handleVerify(newOtp.join(""))
    else inputRefs.current[digits.length]?.focus()
  }

  const handleVerify = async (otpValue = null) => {
    if (showNameInput) return
    const code = otpValue || otp.join("")
    if (code.length !== 4) return
    setIsLoading(true)
    setError("")
    try {
      const phone = authData?.phone
      const purpose = authData?.purpose || "login"
      let fcmToken = null;
      let platform = "web";
      try {
        if (typeof window !== "undefined") {
          if (window.flutter_inappwebview) {
            platform = "mobile";
            const hN = ["getFcmToken", "getFCMToken", "getPushToken", "getFirebaseToken"];
            for (const n of hN) {
              try {
                const t = await window.flutter_inappwebview.callHandler(n, { module: "delivery" });
                if (t?.length > 20) { fcmToken = t.trim(); break; }
              } catch (e) {}
            }
          } else { fcmToken = localStorage.getItem("fcm_web_registered_token_delivery") || null; }
        }
      } catch (e) {}
      setDeviceToken(fcmToken);
      setActivePlatform(platform);

      const response = await deliveryAPI.verifyOTP(phone, code, purpose, null, fcmToken, platform)
      const data = response?.data?.data || response?.data || {}
      if (data.pendingApproval === true) {
        setIsLoading(false); setPendingMessage(data.message); setIsRejected(data.isRejected || false); setRejectionReason(data.rejectionReason || "");
        return
      }
      if (data.needsRegistration === true) {
        useDeliveryOnboardingStore.getState().clearOnboardingState()
        sessionStorage.removeItem("deliveryAuthData")
        sessionStorage.setItem("deliveryNeedsRegistration", "true")
        sessionStorage.setItem("deliverySignupDetails", JSON.stringify({ name: "", phone: phone.replace(/\D/g, "").slice(-10), countryCode: "+91" }))
        setIsLoading(false); navigate("/food/delivery/signup/details", { replace: true });
        return
      }
      const { accessToken, refreshToken, user } = data
      if (accessToken && user) {
        storeAuthData("delivery", accessToken, user, refreshToken)
        window.dispatchEvent(new Event("deliveryAuthChanged"))
        setTimeout(() => navigate("/food/delivery", { replace: true }), 500)
      }
    } catch (err) { setError(err?.response?.data?.message || "Invalid OTP."); setIsLoading(false); }
  }

  const handleSubmitName = async () => {
    if (!name.trim()) { setNameError("Name required"); return; }
    setIsLoading(true); setError(""); try {
      const response = await deliveryAPI.verifyOTP(authData?.phone, verifiedOtp, authData?.purpose || "login", name.trim(), deviceToken, activePlatform)
      const { accessToken, refreshToken, user } = response?.data?.data || response?.data || {}
      if (accessToken && user) {
        storeAuthData("delivery", accessToken, user, refreshToken)
        window.dispatchEvent(new Event("deliveryAuthChanged"))
        navigate("/food/delivery", { replace: true })
      }
    } catch (err) { setError("Failed to complete setup."); } finally { setIsLoading(false); }
  }

  const handleResend = async () => {
    if (resendTimer > 0) return
    setIsLoading(true); setError("")
    try { await deliveryAPI.sendOTP(authData?.phone, authData?.purpose || "login"); setResendTimer(60); }
    catch (err) { setError("Resend failed."); } finally { setIsLoading(false); }
    setOtp(["", "", "", ""]); setShowNameInput(false); setName(""); setVerifiedOtp("")
  }

  if (!authData) return null

  return (
    <div className="min-h-[100dvh] bg-slate-50 dark:bg-[#09090B] flex items-center justify-center font-sans p-4 sm:p-6">
      {/* Compact Center Card */}
      <div className="w-full max-w-[420px] bg-white dark:bg-[#0A0A0B] rounded-[2.5rem] shadow-[0_24px_70px_rgba(0,0,0,0.06)] border border-zinc-100 dark:border-zinc-800/50 flex flex-col overflow-hidden relative">
        
        {/* Top Branding Section - Compact height */}
        <div className={`relative w-full bg-[#00B761] overflow-hidden flex flex-col items-center justify-center text-white transition-all duration-200 min-h-[170px]`}>
          <div className="absolute inset-0 opacity-20">
            <div className="absolute top-0 right-0 w-64 h-64 border border-white/20 rounded-full -mr-20 -mt-20" />
            <div className="absolute bottom-10 left-0 w-32 h-32 border border-white/10 rounded-full -ml-16" />
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
                <ShieldCheck className="w-8 h-8" />
              </div>
            )}
            <div className="space-y-1">
              <h1 className="font-black text-2xl tracking-tight italic uppercase leading-none">
                {isRejected ? "DENIED" : pendingMessage ? "PENDING" : showNameInput ? "CAPTAIN SETUP" : "CAPTAIN VERIFY"}
              </h1>
              <p className="opacity-70 text-[10px] font-bold uppercase tracking-[0.2em]">
                {pendingMessage ? "Verification Required" : showNameInput ? "Complete your profile" : `Sent to ${authData?.phone}`}
              </p>
            </div>
          </motion.div>
        </div>

        {/* Bottom Content Section - Snug & Compact */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="p-8 flex flex-col gap-6"
        >
          <div className="w-full flex flex-col justify-center gap-6">
            <AnimatePresence mode="wait">
              {!pendingMessage ? (
                <motion.div
                  key="input-view"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="space-y-6"
                >
                  {!showNameInput ? (
                    <div className="space-y-6">
                      <div className="flex justify-center gap-3">
                        {otp.map((digit, index) => (
                          <div key={index} className="relative">
                            <input
                              ref={(el) => (inputRefs.current[index] = el)}
                              type="text" inputMode="numeric" maxLength={1} value={digit}
                              onChange={(e) => handleChange(index, e.target.value)}
                              onKeyDown={(e) => handleKeyDown(index, e)}
                              onPaste={handlePaste}
                              onFocus={() => setFocusedIndex(index)}
                              onBlur={() => setFocusedIndex(null)}
                              disabled={isLoading}
                              className={`w-12 h-16 text-center text-2xl font-black bg-zinc-100 dark:bg-zinc-900 border-2 rounded-xl text-zinc-900 dark:text-white transition-all outline-none shadow-sm ${
                                focusedIndex === index ? "border-[#00B761]" : "border-transparent"
                              }`}
                            />
                            {digit && (
                              <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-[#00B761] rounded-full" />
                            )}
                          </div>
                        ))}
                      </div>

                      <div className="space-y-4 pt-2 text-center">
                        {resendTimer > 0 ? (
                          <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">
                            Re-pulse in <span className="text-[#00B761]">{resendTimer}s</span>
                          </p>
                        ) : (
                          <button
                            type="button"
                            onClick={handleResend}
                            disabled={isLoading}
                            className="text-xs font-black text-[#00B761] uppercase tracking-[0.2em] px-6 py-2 rounded-full bg-[#00B761]/5 hover:bg-[#00B761]/10 transition-colors"
                          >
                            Resend Pin
                          </button>
                        )}

                        <Button
                          onClick={() => navigate("/food/delivery/login")}
                          variant="ghost"
                          className="text-zinc-400 dark:text-zinc-600 font-bold text-[10px] uppercase tracking-widest hover:bg-transparent hover:text-zinc-900 h-10 px-4 w-full"
                        >
                          Abort Shift
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <label className="text-[9px] font-black text-zinc-400 uppercase tracking-[0.25em] block text-center">
                            Official Full Name
                          </label>
                          <div className="bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl focus-within:border-[#00B761]/50 focus-within:ring-4 focus-within:ring-[#00B761]/5 transition-all overflow-hidden h-12">
                            <Input
                              type="text" value={name} onChange={(e) => { setName(e.target.value); setNameError(""); }}
                              placeholder="e.g. Aman Kuril"
                              className="h-full bg-transparent border-0 ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 text-base font-black placeholder:text-zinc-300 dark:placeholder:text-zinc-700 px-4 text-center"
                            />
                          </div>
                        </div>
                        {nameError && <p className="text-xs font-bold text-[#00B761] text-center">{nameError}</p>}
                      </div>

                      <Button
                        onClick={handleSubmitName}
                        disabled={isLoading || name.trim().length < 2}
                        className="w-full h-12 bg-[#00B761] hover:bg-[#009049] text-white font-black text-sm uppercase tracking-widest rounded-xl transition-all duration-300 shadow-[0_8px_16px_rgba(0,183,97,0.2)] active:scale-[0.98]"
                      >
                        {isLoading ? (
                          <div className="flex items-center gap-2 justify-center w-full">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span>Initializing...</span>
                          </div>
                        ) : (
                          "Start Riding"
                        )}
                      </Button>
                    </div>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  key="pending-view"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="text-center space-y-6"
                >
                  <div className={`w-16 h-16 mx-auto rounded-2xl flex items-center justify-center shadow-md transform rotate-12 ${isRejected ? "bg-red-50 text-red-600 border border-red-100" : "bg-zinc-50 dark:bg-zinc-900 text-[#00B761] border border-zinc-100 dark:border-zinc-800"}`}>
                     {isRejected ? <AlertCircle size={28} className="-rotate-12" /> : <ShieldCheck size={28} className="-rotate-12" />}
                  </div>

                  <div className="space-y-2">
                    <h3 className={`text-lg font-black italic uppercase tracking-tight ${isRejected ? "text-red-600" : "text-[#00B761]"}`}>
                       {isRejected ? "Onboarding Denied" : "Pending Approval"}
                    </h3>
                    <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 leading-relaxed">
                       {pendingMessage}
                    </p>
                  </div>

                  {isRejected && rejectionReason && (
                     <div className="bg-red-50 dark:bg-red-900/10 p-4 rounded-xl border border-red-100 dark:border-red-900/10">
                        <p className="text-[9px] font-black text-red-400 uppercase tracking-widest mb-1 italic">Fleet Feedback</p>
                        <p className="text-xs text-red-700 dark:text-red-400 font-medium italic">"{rejectionReason}"</p>
                     </div>
                  )}

                  <div className="pt-4 flex flex-col gap-3">
                     {isRejected && (
                        <Button
                          onClick={() => {
                            useDeliveryOnboardingStore.getState().clearOnboardingState()
                            sessionStorage.removeItem("deliverySignupDetails")
                            navigate("/food/delivery/signup/details")
                          }}
                          className="w-full h-12 rounded-xl font-black bg-red-600 hover:bg-red-700 text-white shadow-md text-sm"
                        >
                          RE-APPLY NOW
                        </Button>
                     )}
                     <button 
                      onClick={() => navigate("/food/delivery/login")} 
                      className="text-[9px] font-black text-zinc-400 uppercase tracking-[0.3em] hover:text-[#00B761] transition-all"
                     >
                      BACK TO BASE
                     </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {error && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-4 flex items-center justify-center gap-2 text-xs font-bold text-[#00B761] bg-[#00B761]/5 py-3 px-4 rounded-xl border border-[#00B761]/10"
              >
                <AlertCircle size={14} />
                <span>{error}</span>
              </motion.div>
            )}

            <footer className="text-center pt-2">
              <p className="text-[9px] text-zinc-300 dark:text-zinc-700 font-black uppercase tracking-[0.3em]">
                Fleet Security Network &bull; {companyName.toUpperCase()}
              </p>
            </footer>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
