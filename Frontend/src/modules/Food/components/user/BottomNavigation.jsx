import { Link, useLocation } from "react-router-dom"
import { Tag, User, Truck, ShoppingCart } from "lucide-react"
import { useState, useEffect } from "react"

export default function BottomNavigation() {
  const location = useLocation()
  const pathname = location.pathname
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false)

  useEffect(() => {
    const handleResize = () => {
      const activeEl = document.activeElement
      const isInputFocused = activeEl && (
        activeEl.tagName === "INPUT" ||
        activeEl.tagName === "TEXTAREA" ||
        activeEl.hasAttribute("contenteditable")
      )
      const isHeightShrunk = (window.screen.height - window.innerHeight) > 150
      setIsKeyboardOpen(!!(isInputFocused && isHeightShrunk))
    }

    const handleFocusIn = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") {
        setTimeout(() => {
          setIsKeyboardOpen(true)
        }, 100)
      }
    }

    const handleFocusOut = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") {
        setTimeout(() => {
          const activeEl = document.activeElement
          const stillInput = activeEl && (
            activeEl.tagName === "INPUT" ||
            activeEl.tagName === "TEXTAREA"
          )
          if (!stillInput) {
            setIsKeyboardOpen(false)
          }
        }, 100)
      }
    }

    window.addEventListener("resize", handleResize)
    window.addEventListener("focusin", handleFocusIn)
    window.addEventListener("focusout", handleFocusOut)
    
    return () => {
      window.removeEventListener("resize", handleResize)
      window.removeEventListener("focusin", handleFocusIn)
      window.removeEventListener("focusout", handleFocusOut)
    }
  }, [])

  if (isKeyboardOpen) return null

  // Check active routes - support both /user/* and /* paths
  const isCart = pathname === "/food/cart" || pathname.startsWith("/food/user/cart")
  const isSwitch99 = pathname === "/food/switch-99" || pathname.startsWith("/food/user/switch-99")
  const isProfile = pathname.startsWith("/food/profile") || pathname.startsWith("/food/user/profile")
  const isDelivery =
    !isCart &&
    !isSwitch99 &&
    !isProfile &&
    (pathname === "/food" ||
      pathname === "/food/" ||
      pathname === "/food/user" ||
      (pathname.startsWith("/food/user") &&
        !pathname.includes("/cart") &&
        !pathname.includes("/switch-99") &&
        !pathname.includes("/profile")))

  const activeColor = "var(--module-theme-color, #FA0272)"
  const activeBg = "rgba(var(--module-theme-rgb, 250,2,114), 0.12)"
  const activeFill = "rgba(var(--module-theme-rgb, 250,2,114), 0.2)"

  return (
    <div
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 pointer-events-none"
    >
      <div className="flex items-center justify-around h-auto px-2 py-1.5 bg-white/95 dark:bg-[#1a1a1a]/95 backdrop-blur-[20px] border-t border-gray-200/60 dark:border-white/10 shadow-[0_-4px_20px_rgba(0,0,0,0.08)] pointer-events-auto" style={{ paddingBottom: "env(safe-area-inset-bottom, 6px)" }}>
        
        {/* Delivery Tab */}
        <Link
          to="/food/user"
          className={`flex flex-1 flex-col items-center justify-center gap-1 px-1 py-1.5 transition-all duration-300 relative rounded-full ${isDelivery
              ? ""
              : "text-gray-500 dark:text-gray-400 hover:bg-gray-100/50 dark:hover:bg-gray-800/50"
            }`}
          style={isDelivery ? { color: activeColor, backgroundColor: activeBg } : undefined}
        >
          <div className="relative">
            <Truck className={`h-5 w-5 transition-transform duration-300 ${isDelivery ? "scale-110" : "text-gray-500 dark:text-gray-400"}`} strokeWidth={isDelivery ? 2.5 : 2} style={isDelivery ? { color: activeColor, fill: activeFill } : undefined} />
          </div>
          <span className={`text-[10px] sm:text-xs font-semibold tracking-wide transition-all ${isDelivery ? "" : "text-gray-500 dark:text-gray-400 opacity-80"}`}>
            Delivery
          </span>
        </Link>

        {/* Cart Tab */}
        <Link
          to="/food/user/cart"
          className={`flex flex-1 flex-col items-center justify-center gap-1 px-1 py-1.5 transition-all duration-300 relative rounded-full ${isCart
              ? ""
              : "text-gray-500 dark:text-gray-400 hover:bg-gray-100/50 dark:hover:bg-gray-800/50"
            }`}
          style={isCart ? { color: activeColor, backgroundColor: activeBg } : undefined}
        >
          <div className="relative">
            <ShoppingCart className={`h-5 w-5 transition-transform duration-300 ${isCart ? "scale-110" : "text-gray-500 dark:text-gray-400"}`} strokeWidth={isCart ? 2.5 : 2} style={isCart ? { color: activeColor } : undefined} />
          </div>
          <span className={`text-[10px] sm:text-xs font-semibold tracking-wide transition-all ${isCart ? "" : "text-gray-500 dark:text-gray-400 opacity-80"}`}>
            Cart
          </span>
        </Link>

        {/* Under 250 Tab */}
        <Link
          to="/food/user/switch-99"
          className={`flex flex-1 flex-col items-center justify-center gap-1 px-1 py-1.5 transition-all duration-300 relative rounded-full ${isSwitch99
              ? ""
              : "text-gray-500 dark:text-gray-400 hover:bg-gray-100/50 dark:hover:bg-gray-800/50"
            }`}
          style={isSwitch99 ? { color: activeColor, backgroundColor: activeBg } : undefined}
        >
          <div className="relative">
            <Tag className={`h-5 w-5 transition-transform duration-300 ${isSwitch99 ? "scale-110" : "text-gray-500 dark:text-gray-400"}`} strokeWidth={isSwitch99 ? 2.5 : 2} style={isSwitch99 ? { color: activeColor, fill: activeFill } : undefined} />
          </div>
          <span className={`text-[10px] sm:text-xs font-semibold tracking-wide transition-all ${isSwitch99 ? "" : "text-gray-500 dark:text-gray-400 opacity-80"}`}>
            Switch 99
          </span>
        </Link>

        {/* Profile Tab */}
        <Link
          to="/food/user/profile"
          className={`flex flex-1 flex-col items-center justify-center gap-1 px-1 py-1.5 transition-all duration-300 relative rounded-full ${isProfile
              ? ""
              : "text-gray-500 dark:text-gray-400 hover:bg-gray-100/50 dark:hover:bg-gray-800/50"
            }`}
          style={isProfile ? { color: activeColor, backgroundColor: activeBg } : undefined}
        >
          <div className="relative">
            <User className={`h-5 w-5 transition-transform duration-300 ${isProfile ? "scale-110" : "text-gray-500 dark:text-gray-400"}`} strokeWidth={isProfile ? 2.5 : 2} style={isProfile ? { color: activeColor, fill: activeFill } : undefined} />
          </div>
          <span className={`text-[10px] sm:text-xs font-semibold tracking-wide transition-all ${isProfile ? "" : "text-gray-500 dark:text-gray-400 opacity-80"}`}>
            Profile
          </span>
        </Link>
      </div>
    </div>
  )
}
