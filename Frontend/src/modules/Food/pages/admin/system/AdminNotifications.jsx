import { useEffect, useMemo, useState } from "react"
import { Bell, Clock, Loader2, Trash2, X } from "lucide-react"
import { useNavigate } from "react-router-dom"
import useAdminNotifications from "@food/hooks/useAdminNotifications"

const toDateLabel = (value) => {
  const date = value ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) return "N/A"
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  })
}

const normalizeLiveNotificationItem = (payload = {}) => {
  const id = String(payload?.id || payload?.ticketId || payload?.orderId || payload?.orderMongoId || "").trim()
  if (!id) return null

  return {
    id: String(payload?.id || `live-admin-${String(payload?.type || payload?.category || "notification").toLowerCase()}-${id}`),
    title: payload?.title || "New admin notification",
    message: payload?.message || payload?.body || "",
    type: payload?.type || "notification",
    category: payload?.category || "live_admin",
    path: payload?.path || "/admin/food/notifications",
    originPath: payload?.originPath || payload?.sourcePath || "",
    createdAt: payload?.createdAt || new Date().toISOString(),
    timeLabel: toDateLabel(payload?.createdAt || new Date().toISOString()),
    metaLabel: payload?.metaLabel || [payload?.restaurantName, payload?.issueType, payload?.ticketType].filter(Boolean).join(" "),
  }
}

export default function AdminNotifications() {
  const navigate = useNavigate()
  const { items, loading, clearAll, dismissOne } = useAdminNotifications()
  const [liveItems, setLiveItems] = useState([])

  useEffect(() => {
    if (typeof window === "undefined") return undefined

    const handleLiveNotification = (event) => {
      const item = normalizeLiveNotificationItem(event?.detail || {})
      if (!item) return

      setLiveItems((prev) => {
        const next = [item, ...prev.filter((entry) => entry.id !== item.id)]
        return next.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      })
    }

    window.addEventListener("adminOrderNotificationReceived", handleLiveNotification)
    window.addEventListener("adminNotificationReceived", handleLiveNotification)
    return () => {
      window.removeEventListener("adminOrderNotificationReceived", handleLiveNotification)
      window.removeEventListener("adminNotificationReceived", handleLiveNotification)
    }
  }, [])

  const allItems = useMemo(() => [...liveItems, ...items], [items, liveItems])

  const dismissLiveOne = (id) => {
    setLiveItems((prev) => prev.filter((item) => item.id !== id))
  }

  return (
    <div className="p-6">
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <Bell className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Notifications</h1>
              <p className="text-sm text-slate-500">
                Approval, support, and live order alerts that need admin attention.
              </p>
            </div>
          </div>
          {allItems.length > 0 && (
            <button
              type="button"
              onClick={() => {
                clearAll()
                setLiveItems([])
              }}
              className="inline-flex items-center gap-2 rounded-2xl border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"
            >
              <Trash2 className="w-4 h-4" />
              Clear all
            </button>
          )}
        </div>

        {loading ? (
          <div className="py-12 text-sm text-slate-500 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading notifications...
          </div>
        ) : allItems.length === 0 ? (
          <div className="py-12 text-sm text-slate-500">No notifications found.</div>
        ) : (
          <div className="space-y-4">
            {liveItems.length > 0 && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-amber-900">Live Admin Alerts</p>
                    <p className="text-xs text-amber-700">Newest live admin notifications from the socket.</p>
                  </div>
                </div>
                <div className="space-y-3">
                  {liveItems.map((item) => (
                    <div key={item.id} className="rounded-2xl border border-amber-200 bg-white px-4 py-4">
                      <div className="flex items-start justify-between gap-4">
                        <button
                          type="button"
                          onClick={() => item?.path && navigate(item.path)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <p className="text-base font-semibold text-slate-900">{item.title}</p>
                          <p className="text-sm text-slate-600 mt-1">{item.message}</p>
                          <div className="flex items-center gap-2 mt-3 text-xs text-slate-500">
                            <Clock className="w-3.5 h-3.5" />
                            <span>{item.timeLabel || "N/A"}</span>
                            {item.metaLabel ? (
                              <>
                                <span>•</span>
                                <span>{item.metaLabel}</span>
                              </>
                            ) : null}
                          </div>
                          {item.originPath ? (
                            <p className="mt-2 text-[11px] font-medium text-slate-400 break-all">Source: {item.originPath}</p>
                          ) : null}
                        </button>
                        <button
                          type="button"
                          onClick={() => dismissLiveOne(item.id)}
                          className="shrink-0 rounded-full p-2 text-slate-400 hover:text-red-600 hover:bg-red-50"
                          aria-label="Delete notification"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-3">
              {items.map((item) => (
                <div
                  key={item?.id}
                  className="rounded-2xl border border-slate-200 bg-slate-50/50 px-4 py-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <button
                      type="button"
                      onClick={() => item?.path && navigate(item.path)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <p className="text-base font-semibold text-slate-900">
                        {item?.title || "Notification"}
                      </p>
                      <p className="text-sm text-slate-600 mt-1">
                        {item?.message || "-"}
                      </p>
                      <div className="flex items-center gap-2 mt-3 text-xs text-slate-500">
                        <Clock className="w-3.5 h-3.5" />
                        <span>{item?.timeLabel || "N/A"}</span>
                        {item?.metaLabel ? (
                          <>
                            <span>•</span>
                            <span>{item.metaLabel}</span>
                          </>
                        ) : null}
                      </div>
                      {item?.originPath ? (
                        <p className="mt-2 text-[11px] font-medium text-slate-400 break-all">Source: {item.originPath}</p>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      onClick={() => dismissOne(item?.id)}
                      className="shrink-0 rounded-full p-2 text-slate-400 hover:text-red-600 hover:bg-red-50"
                      aria-label="Delete notification"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}


