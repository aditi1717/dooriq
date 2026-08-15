import { useMemo, useState, useEffect } from "react"
import { Loader2, X, ArrowRight } from "lucide-react"

import { CANCEL_OPTION, currentStatusLabel, getForwardStatuses } from "./orderStatusFlow"

export default function ChangeOrderStatusModal({ isOpen, onOpenChange, order, onConfirm, isSubmitting }) {
  const [selected, setSelected] = useState("")
  const [note, setNote] = useState("")

  const backendStatus = order?.backendStatus || ""
  const options = useMemo(() => getForwardStatuses(backendStatus), [backendStatus])

  useEffect(() => {
    if (isOpen) {
      setSelected("")
      setNote("")
    }
  }, [isOpen, order?.id])

  if (!isOpen || !order) return null

  const isCancel = selected === CANCEL_OPTION.value
  const close = () => { if (!isSubmitting) onOpenChange(false) }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={close} />

      <div className="relative w-full max-w-md rounded-2xl bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-slate-100 p-5">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Change Order Status</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Order #{order.orderId || order.id}
            </p>
          </div>
          <button
            onClick={close}
            disabled={isSubmitting}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5">
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-sm">
            <span className="text-slate-500">Current</span>
            <span className="font-medium text-slate-900">{currentStatusLabel(backendStatus)}</span>
            {selected && (
              <>
                <ArrowRight className="h-4 w-4 text-slate-400" />
                <span className={`font-medium ${isCancel ? "text-rose-600" : "text-emerald-600"}`}>
                  {options.find((o) => o.value === selected)?.label}
                </span>
              </>
            )}
          </div>

          {options.length === 0 ? (
            <p className="rounded-lg bg-amber-50 px-3 py-3 text-sm text-amber-800">
              This order is {currentStatusLabel(backendStatus).toLowerCase()} and can no longer be changed.
              Order status only moves forward.
            </p>
          ) : (
            <>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                Move forward to
              </p>
              <div className="max-h-64 space-y-1.5 overflow-y-auto">
                {options.map((option) => {
                  const active = selected === option.value
                  const cancel = option.value === CANCEL_OPTION.value
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setSelected(option.value)}
                      disabled={isSubmitting}
                      className={`w-full rounded-lg border p-3 text-left transition-colors disabled:opacity-50 ${
                        active
                          ? cancel
                            ? "border-rose-300 bg-rose-50"
                            : "border-orange-300 bg-orange-50"
                          : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                      } ${cancel && !active ? "mt-3 border-dashed" : ""}`}
                    >
                      <div className={`text-sm font-medium ${cancel ? "text-rose-700" : "text-slate-900"}`}>
                        {option.label}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">{option.hint}</div>
                    </button>
                  )
                })}
              </div>

              <div className="mt-4">
                <label htmlFor="status-note" className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-400">
                  Note {isCancel ? "(shown to the customer)" : "(optional)"}
                </label>
                <textarea
                  id="status-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  disabled={isSubmitting}
                  rows={2}
                  maxLength={200}
                  placeholder={isCancel ? "Reason for cancellation" : "Why this status was changed"}
                  className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition-colors focus:border-orange-400 disabled:opacity-50"
                />
              </div>

              {isCancel && (
                <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2.5 text-xs text-rose-700">
                  Cancelling runs the normal refund flow and notifies the customer,
                  restaurant and rider. This cannot be undone.
                </p>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 p-5">
          <button
            onClick={close}
            disabled={isSubmitting}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(order, selected, note.trim())}
            disabled={!selected || isSubmitting || options.length === 0}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              isCancel ? "bg-rose-600 hover:bg-rose-700" : "bg-orange-600 hover:bg-orange-700"
            }`}
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {isSubmitting ? "Updating..." : "Update Status"}
          </button>
        </div>
      </div>
    </div>
  )
}
