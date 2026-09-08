import React from "react"

export default function Loader() {
  return (
    <div className="min-h-[50vh] w-full flex flex-col items-center justify-center p-6 space-y-3">
      <div className="relative w-10 h-10 flex items-center justify-center">
        <div className="w-9 h-9 rounded-full border-3 border-t-transparent animate-spin" style={{ borderColor: 'var(--module-theme-color, #FA0272)', borderTopColor: 'transparent' }} />
      </div>
      <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 tracking-wider uppercase animate-pulse">
        Loading...
      </p>
    </div>
  )
}
