/**
 * Admin order-status progression policy.
 *
 * Pure data + logic, deliberately free of React so it can be unit-tested
 * directly against the backend rule it mirrors.
 *
 * Source of truth is the server: STATUS_PRIORITY / isStatusAdvance in
 * Backend/src/modules/food/orders/services/order.helpers.js, and the
 * ADMIN_SETTABLE_ORDER_STATUSES allow-list in the order controller. What lives
 * here only decides what the admin is OFFERED - the server re-validates every
 * transition, so a stale tab or a hand-crafted request still cannot move an
 * order backwards.
 */

export const STATUS_FLOW = [
  { value: "confirmed", label: "Accepted", priority: 20, hint: "Restaurant has accepted the order" },
  { value: "preparing", label: "Preparing", priority: 30, hint: "Food is being prepared" },
  { value: "ready_for_pickup", label: "Ready for Pickup", priority: 40, hint: "Food is ready, awaiting rider" },
  { value: "reached_pickup", label: "Rider Reached Restaurant", priority: 50, hint: "Rider is at the restaurant" },
  { value: "picked_up", label: "Picked Up / On The Way", priority: 60, hint: "Rider has collected the order" },
  { value: "reached_drop", label: "Rider Reached Customer", priority: 70, hint: "Rider is at the delivery address" },
  { value: "delivered", label: "Delivered", priority: 80, hint: "Order completed" },
]

export const CANCEL_OPTION = {
  value: "cancelled_by_admin",
  label: "Cancel Order",
  priority: 100,
  hint: "Cancels the order and triggers the standard refund flow",
}

/** Mirrors STATUS_PRIORITY on the server. */
export const PRIORITY_BY_STATUS = {
  created: 10,
  confirmed: 20,
  preparing: 30,
  ready_for_pickup: 40,
  reached_pickup: 50,
  picked_up: 60,
  reached_drop: 70,
  delivered: 80,
  cancelled_by_user: 100,
  cancelled_by_restaurant: 100,
  cancelled_by_admin: 100,
}

/** Human label for the order's current backend status. */
export const currentStatusLabel = (status) => {
  if (!status || status === "created") return "Pending"
  const match = STATUS_FLOW.find((s) => s.value === status)
  if (match) return match.label
  if (String(status).includes("cancel")) return "Cancelled"
  return String(status).replace(/_/g, " ")
}

/**
 * Statuses this order may still move to.
 *
 * Returns an empty list once the order is delivered or cancelled - those are
 * terminal on the server too, so the action button hides entirely.
 */
export const getForwardStatuses = (backendStatus) => {
  const current = PRIORITY_BY_STATUS[backendStatus] ?? 0
  if (current >= 80) return []
  return [...STATUS_FLOW.filter((s) => s.priority > current), CANCEL_OPTION]
}
