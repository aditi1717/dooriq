import { useEffect, useMemo, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { ArrowLeft, Check, Copy, Download, Smartphone } from "lucide-react"
import { useCompanyName } from "@food/hooks/useCompanyName"

const APP_STORE_URL = "#"
const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.dooriq.delivery"
const INVITE_STORAGE_KEY = "food_delivery_invite_ref"

export default function DeliveryReferralInvitePage() {
  const companyName = useCompanyName()
  const [searchParams] = useSearchParams()
  const ref = String(searchParams.get("ref") || "").trim()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!ref || typeof window === "undefined") return
    try {
      localStorage.setItem(INVITE_STORAGE_KEY, ref)
    } catch {
      // Ignore storage failures.
    }
  }, [ref])

  const inviteText = useMemo(() => {
    return ref
      ? `Download the ${companyName} Captain app to accept this invite. Use referral code ${ref} after installing.`
      : `Download the ${companyName} Captain app to continue.`
  }, [companyName, ref])

  const copyCode = async () => {
    if (!ref) return
    try {
      await navigator.clipboard.writeText(ref)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#f0fff7] via-white to-[#eef6ff] text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between gap-4">
          <Link to="/food/user" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs font-semibold text-emerald-700 shadow-sm">
            <Smartphone className="h-3.5 w-3.5" />
            Install captain app
          </span>
        </div>

        <div className="flex flex-1 items-center">
          <div className="w-full rounded-[2rem] border border-white/80 bg-white/90 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.10)] backdrop-blur sm:p-8">
            <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-200/60">
              <Download className="h-7 w-7" />
            </div>

            <p className="text-xs font-black uppercase tracking-[0.35em] text-emerald-600">Delivery Partner Invite</p>
            <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">
              Download the captain app first.
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-6 text-slate-600 sm:text-base">
              {inviteText}
            </p>

            {ref ? (
              <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500">Referral code</p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <code className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-slate-900 shadow-sm">{ref}</code>
                  <button
                    type="button"
                    onClick={copyCode}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                  >
                    {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                    {copied ? "Copied" : "Copy code"}
                  </button>
                </div>
              </div>
            ) : null}

            <div className="mt-6 flex flex-col gap-3">
              <Link
                to={`/food/delivery/login${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`}
                className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-4 text-sm font-black text-white hover:bg-emerald-700 transition shadow-lg shadow-emerald-200"
              >
                Open App & Join as Captain
              </Link>

              <div className="grid gap-3 sm:grid-cols-2">
                <a
                  href={APP_STORE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 py-4 text-sm font-bold text-white transition hover:bg-slate-800"
                >
                  App Store
                </a>
                <a
                  href={PLAY_STORE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm font-bold text-slate-800 transition hover:bg-slate-50"
                >
                  Google Play
                </a>
              </div>
            </div>

            <p className="mt-6 text-xs leading-5 text-slate-500">
              Install the app on your phone, then open it and use the referral code during signup.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
