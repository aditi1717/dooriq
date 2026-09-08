import { useNavigate, useLocation } from "react-router-dom"
import { memo, useMemo, useState, useEffect } from "react"
import { motion } from "framer-motion"
import {
  FileText,
  Package,
  Wallet,
  Compass,
} from "lucide-react"

const getOrdersTabs = (basePath = "/restaurant") => [
  { id: "orders", label: "Orders", icon: FileText, route: `${basePath}` },
  { id: "inventory", label: "Inventory", icon: Package, route: `${basePath}/inventory` },
  { id: "payouts", label: "Payouts", icon: Wallet, route: `${basePath}/hub-finance` },
  { id: "explore", label: "Explore", icon: Compass, route: `${basePath}/explore` },
]

const findActiveTab = (tabs, pathname) =>
  tabs
    .slice()
    .sort((a, b) => b.route.length - a.route.length)
    .find((tab) => pathname === tab.route || pathname.startsWith(tab.route + "/"))

function BottomNavOrders() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false)

  useEffect(() => {
    const handleFocusIn = (e) => {
      const tag = e.target.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || e.target.hasAttribute("contenteditable")) {
        setIsKeyboardOpen(true)
      }
    }

    const handleFocusOut = () => {
      setTimeout(() => {
        const activeEl = document.activeElement
        const isInputFocused = activeEl && (
          activeEl.tagName === "INPUT" ||
          activeEl.tagName === "TEXTAREA" ||
          activeEl.hasAttribute("contenteditable")
        )
        if (!isInputFocused) {
          setIsKeyboardOpen(false)
        }
      }, 100)
    }

    window.addEventListener("focusin", handleFocusIn)
    window.addEventListener("focusout", handleFocusOut)
    
    return () => {
      window.removeEventListener("focusin", handleFocusIn)
      window.removeEventListener("focusout", handleFocusOut)
    }
  }, [])

  const basePath = pathname.startsWith("/food/restaurant")
    ? "/food/restaurant"
    : pathname.startsWith("/restaurant")
      ? "/food/restaurant"
      : "/restaurant"

  const tabs = useMemo(() => getOrdersTabs(basePath), [basePath])

  const activeTab = useMemo(() => {
    const match = findActiveTab(tabs, pathname)
    return match?.id || "orders"
  }, [tabs, pathname])

  const handleTabClick = (tab) => {
    if (tab.route && tab.route !== pathname) {
      navigate(tab.route)
    }
  }

  const isInternalPage = pathname.includes("/create-offers")
  if (isInternalPage || isKeyboardOpen) {
    return null
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[60]">
      <div className="w-full">
        <div className="relative overflow-hidden bg-white/95 dark:bg-[#121212]/95 backdrop-blur-xl py-2 px-2.5 shadow-[0_-4px_20px_rgba(0,0,0,0.08)] border-t border-gray-200 dark:border-gray-800">
          <div className="relative flex items-center justify-around gap-1.5">
            {tabs.map((tab) => {
              const Icon = tab.icon
              const isActive = activeTab === tab.id

              return (
                <motion.button
                  key={tab.id}
                  type="button"
                  onClick={() => handleTabClick(tab)}
                  aria-current={isActive ? "page" : undefined}
                  className="relative z-10 flex min-w-0 flex-1 flex-col items-center justify-center gap-1 py-1.5 rounded-2xl transition-colors duration-200"
                  whileTap={{ scale: 0.95 }}
                >
                  {isActive && (
                    <motion.div
                      layoutId="bottomNavActive"
                      className="absolute inset-0 rounded-2xl shadow-2xs"
                      style={{
                        backgroundColor: "rgba(var(--module-theme-rgb, 250,2,114), 0.12)",
                        border: "1px solid rgba(var(--module-theme-rgb, 250,2,114), 0.28)"
                      }}
                      initial={false}
                      transition={{ type: "spring", stiffness: 400, damping: 30 }}
                    />
                  )}
                  <Icon
                    className={`relative z-10 h-[20px] w-[20px] transition-all duration-300 ${
                      isActive 
                        ? "scale-110" 
                        : "text-gray-500 dark:text-gray-400 group-hover:text-gray-700"
                    }`}
                    style={isActive ? { color: "var(--module-theme-color, #FA0272)" } : undefined}
                  />
                  <span
                    className={`relative z-10 whitespace-nowrap text-[10px] tracking-tight transition-colors duration-300 ${
                      isActive 
                        ? "font-extrabold" 
                        : "text-gray-500 dark:text-gray-400 font-semibold"
                    }`}
                    style={isActive ? { color: "var(--module-theme-color, #FA0272)" } : undefined}
                  >
                    {tab.label}
                  </span>
                </motion.button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

export default memo(BottomNavOrders)
