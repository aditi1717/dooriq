import { useEffect, useRef } from "react"
import io from "socket.io-client"
import { toast } from "sonner"
import { API_BASE_URL } from "@food/api/config"

const DEBUG_PREFIX = "[admin-order-push]"
const DEDUPE_MS = 8000
const NOTIFICATION_PERMISSION_ASKED_KEY = "admin_notification_permission_asked"

const supportsBrowserNotifications = () =>
  typeof window !== "undefined" && typeof Notification !== "undefined"

const log = (...args) => console.log(DEBUG_PREFIX, ...args)
const warn = (...args) => console.warn(DEBUG_PREFIX, ...args)

const dispatchAdminNotificationsUpdated = () => {
  if (typeof window === "undefined") return
  window.dispatchEvent(new Event("adminNotificationsUpdated"))
}

const getBackendSocketUrl = () => {
  const base = String(API_BASE_URL || "").trim()
  if (!base) return ""

  try {
    const origin = new URL(base, typeof window !== "undefined" ? window.location.origin : undefined).origin
    return origin
  } catch {
    return base
      .replace(/\/api\/v\d+\/?$/i, "")
      .replace(/\/api\/?$/i, "")
      .replace(/\/+$/, "")
  }
}

const buildNotification = (payload = {}) => {
  const orderId = payload?.orderId || payload?.orderMongoId || payload?.id || ""
  const title = String(payload?.title || "New order received").trim()
  const body = String(
    payload?.message ||
      payload?.body ||
      (payload?.restaurantName ? `${payload.restaurantName} - ${orderId}` : `Order ${orderId}`),
  ).trim()

  return {
    title,
    body,
    tag: `admin-order-${orderId || Date.now()}`,
    data: payload,
  }
}

const LIVE_ADMIN_STORAGE_KEY = "admin_live_notifications_v1"

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

const readLiveNotifications = () => {
  if (typeof localStorage === "undefined") return []
  try {
    const raw = localStorage.getItem(LIVE_ADMIN_STORAGE_KEY) || "[]"
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const saveLiveNotifications = (items = []) => {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(LIVE_ADMIN_STORAGE_KEY, JSON.stringify(Array.isArray(items) ? items : []))
  } catch {
    // Ignore storage quota / availability issues.
  }
}

const buildLiveNotificationItem = (payload = {}) => {
  const rawOrderId = String(payload?.orderId || payload?.orderMongoId || "").trim()
  const rawTicketId = String(payload?.ticketId || payload?.supportTicketId || payload?.id || "").trim()
  const kind = String(payload?.category || payload?.type || payload?.source || "").toLowerCase()
  const isSupport = kind.includes("support") || String(payload?.path || "").includes("/support-tickets")
  const isOrder = Boolean(rawOrderId) && !isSupport
  const baseId = isOrder ? rawOrderId : rawTicketId || String(payload?.message || payload?.title || Date.now())
  const path = isOrder
    ? `/admin/food/orders/all?orderId=${rawOrderId}`
    : String(payload?.adminPath || payload?.path || "/admin/food/support-tickets")
  const originPath = String(payload?.originPath || payload?.sourcePath || "").trim()

  return {
    id: isOrder ? `live-admin-order-${baseId}` : `live-admin-support-${baseId}`,
    title: payload?.title || (isSupport ? "New support ticket received" : "New order received"),
    message:
      payload?.message ||
      payload?.body ||
      (isOrder
        ? `Order #${baseId} has a new update.`
        : "A new support ticket needs admin attention."),
    type: isSupport ? "support" : "order",
    category: isSupport ? "support" : "live_order",
    path,
    originPath,
    createdAt: payload?.createdAt || new Date().toISOString(),
    timeLabel: toDateLabel(payload?.createdAt || new Date().toISOString()),
    metaLabel: isOrder
      ? [payload?.restaurantName, baseId].filter(Boolean).join(" • ")
      : [payload?.issueType, payload?.ticketType || payload?.type].filter(Boolean).join(" • "),
  }
}

const persistLiveOrderNotification = (payload = {}) => {
  const nextItem = buildLiveNotificationItem(payload)
  const existing = readLiveNotifications()
  const filtered = existing.filter((item) => item?.id !== nextItem.id)
  saveLiveNotifications([nextItem, ...filtered].slice(0, 50))
  dispatchAdminNotificationsUpdated()
}

const emitAdminNotificationToPage = (payload = {}) => {
  if (typeof window === "undefined") return
  const item = buildLiveNotificationItem(payload)
  window.dispatchEvent(new CustomEvent("adminNotificationReceived", { detail: item }))
  if (item.type === "order") {
    window.dispatchEvent(
      new CustomEvent("adminOrderNotificationReceived", {
        detail: {
          ...item,
          orderId: String(payload?.orderId || payload?.orderMongoId || payload?.id || "").trim(),
          orderMongoId: String(payload?.orderMongoId || payload?.orderId || payload?.id || "").trim(),
          restaurantName: payload?.restaurantName || "",
          originPath: payload?.originPath || payload?.sourcePath || "",
        },
      }),
    )
  }
}
async function showBrowserNotification(payload = {}) {
  if (!supportsBrowserNotifications()) {
    warn("Browser notifications unsupported")
    return
  }

  log("Browser notification permission", Notification.permission)
  if (Notification.permission !== "granted") return

  const notification = buildNotification(payload)
  try {
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.getRegistration()
      if (registration) {
        await registration.showNotification(notification.title, {
          body: notification.body,
          tag: notification.tag,
          renotify: true,
          requireInteraction: true,
          silent: false,
          icon: "/favicon.ico",
          data: notification.data,
        })
        log("Browser notification shown via service worker", { tag: notification.tag })
        return
      }
    }

    new Notification(notification.title, {
      body: notification.body,
      tag: notification.tag,
      requireInteraction: true,
      silent: false,
      icon: "/favicon.ico",
      data: notification.data,
    })
    log("Browser notification shown via Notification API", { tag: notification.tag })
  } catch (error) {
    warn("Browser notification failed", error?.message || error)
  }
}

function playAlertSound() {
  try {
    const audio = new Audio("/zomato_sms.mp3")
    audio.volume = 1
    void audio.play()
      .then(() => log("Alert sound played"))
      .catch((error) => warn("Alert sound blocked", error?.message || error))
  } catch (error) {
    warn("Alert sound setup failed", error?.message || error)
  }
}

function unlockAudioOnInteraction() {
  const handler = () => {
    log("User interaction detected, priming audio")
    playAlertSound()
    window.removeEventListener("pointerdown", handler)
    window.removeEventListener("keydown", handler)
  }

  window.addEventListener("pointerdown", handler, { once: true })
  window.addEventListener("keydown", handler, { once: true })
}

export default function useAdminOrderNotifications() {
  const socketRef = useRef(null)
  const lastHandledRef = useRef(new Map())

  useEffect(() => {
    if (typeof window === "undefined") return undefined

    log("Hook mounted", {
      apiBaseUrl: API_BASE_URL,
      notificationPermission: supportsBrowserNotifications() ? Notification.permission : "unsupported",
      currentPath: window.location.pathname,
      hasAdminToken: Boolean(localStorage.getItem("admin_accessToken")),
    })

    const connect = () => {
      const token = localStorage.getItem("admin_accessToken")
      const backendUrl = getBackendSocketUrl()
      log("connect() called", {
        tokenPresent: Boolean(token),
        backendUrl,
        apiBaseUrl: API_BASE_URL,
        path: window.location.pathname,
      })

      if (!token || !backendUrl || !backendUrl.startsWith("http")) {
        warn("Skipping socket connect", {
          tokenPresent: Boolean(token),
          backendUrl,
        })
        if (socketRef.current) {
          socketRef.current.disconnect()
          socketRef.current = null
        }
        return
      }

      if (socketRef.current) {
        log("Disconnecting existing socket before reconnect")
        socketRef.current.disconnect()
        socketRef.current = null
      }

      const socket = io(backendUrl, {
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 20000,
        auth: { token },
      })

      socket.on("connect", () => {
        log("Socket connected", {
          socketId: socket.id,
          transport: socket.io?.engine?.transport?.name || "unknown",
        })
        socket.emit("join-admin-orders")
        log("join-admin-orders emitted")
      })

      socket.on("admin-orders-room-joined", (data) => {
        log("Admin orders room joined", data)
      })

      socket.on("admin_new_order", (payload = {}) => {
        log("admin_new_order received", payload)
        const orderId = String(payload?.orderId || payload?.orderMongoId || payload?.id || "").trim()
        const key = orderId || String(payload?.message || payload?.title || "admin-order")
        const now = Date.now()
        const last = lastHandledRef.current.get(key) || 0
        if (now - last < DEDUPE_MS) {
          log("Duplicate event skipped", { key })
          return
        }
        lastHandledRef.current.set(key, now)

        const notification = buildNotification(payload)
        toast.info(notification.title, { description: notification.body })
        persistLiveOrderNotification(payload)
        log("Toast shown", notification)
        emitAdminNotificationToPage(payload)
        playAlertSound()
        void showBrowserNotification(payload)
      })

      socket.on("admin_notification", (payload = {}) => {
        log("admin_notification received", payload)
        const notification = buildNotification(payload)
        toast.info(notification.title, { description: notification.body })
        persistLiveOrderNotification(payload)
        log("Toast shown", notification)
        emitAdminNotificationToPage(payload)
        playAlertSound()
        void showBrowserNotification(payload)
      })
      socket.on("play_notification_sound", (payload = {}) => {
        log("play_notification_sound received", payload)
        playAlertSound()
      })

      socket.on("connect_error", (error) => {
        warn("connect_error", {
          message: error?.message,
          type: error?.type,
          description: error?.description,
          data: error?.data,
        })
      })

      socket.on("disconnect", (reason) => {
        warn("disconnect", { reason })
      })

      socketRef.current = socket
    }

    connect()

    if (supportsBrowserNotifications() && Notification.permission === "default") {
      const alreadyAsked =
        typeof localStorage !== "undefined" &&
        localStorage.getItem(NOTIFICATION_PERMISSION_ASKED_KEY) === "true"

      if (!alreadyAsked) {
        const askOnce = async () => {
          try {
            localStorage.setItem(NOTIFICATION_PERMISSION_ASKED_KEY, "true")
            const result = await Notification.requestPermission()
            log("Notification permission result", result)
          } catch (error) {
            warn("Notification permission request failed", error?.message || error)
          }
        }

        const requestOnInteraction = () => {
          void askOnce()
          window.removeEventListener("pointerdown", requestOnInteraction)
        }

        window.addEventListener("pointerdown", requestOnInteraction, { once: true })
      }
    }

    unlockAudioOnInteraction()

    const handleAuthChange = () => {
      log("adminAuthChanged/storage event received, reconnecting")
      connect()
    }

    window.addEventListener("adminAuthChanged", handleAuthChange)
    window.addEventListener("storage", handleAuthChange)

    return () => {
      log("Hook cleanup")
      window.removeEventListener("adminAuthChanged", handleAuthChange)
      window.removeEventListener("storage", handleAuthChange)
      if (socketRef.current) {
        socketRef.current.disconnect()
        socketRef.current = null
      }
    }
  }, [])
}



