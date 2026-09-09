import { useState, useEffect, useCallback } from "react"
import { toast } from "sonner"
import api from "@food/api"
import { API_ENDPOINTS } from "@food/api/config"

const debugError = () => {}

const SUPPORT_EMAIL_REGEX = /^(?!.*\.\.)([A-Za-z0-9]+[._%+-]?)*[A-Za-z0-9]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}$/
const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/

const hasSuspiciousEmailTld = (emailValue) => {
  const email = String(emailValue || "").trim().toLowerCase()
  const domain = email.split("@")[1] || ""
  const tld = domain.split(".").pop() || ""
  if (!tld) return true
  if (/^com+$/i.test(tld) && tld !== "com") return true
  if (/(.)\1{2,}/.test(tld)) return true
  return false
}

/**
 * The icon strings the mobile apps can actually draw.
 *
 * The apps map this string to a Material icon (see _iconFor() in
 * help_support_screen.dart). Anything not in this list renders as a generic
 * help circle — not broken, but not what anyone intended — so the editor only
 * offers keys that are known to resolve.
 */
const ICON_OPTIONS = [
  { value: "description", label: "Document — FAQs, policies" },
  { value: "assignment", label: "Clipboard — orders, tasks" },
  { value: "replay", label: "Refresh — refunds, retries" },
  { value: "shield", label: "Shield — safety, report a problem" },
  { value: "access_time", label: "Clock — hours, timing" },
  { value: "verified_user", label: "Verified — response time, trust" },
  { value: "groups", label: "People — community, care" },
]

const ICON_GLYPH = {
  description: "📄",
  assignment: "📋",
  replay: "🔄",
  shield: "🛡️",
  access_time: "🕘",
  verified_user: "✅",
  groups: "👥",
}

const MODULES = [
  { value: "USER", label: "User App" },
  { value: "RESTAURANT", label: "Restaurant App" },
  { value: "DELIVERY", label: "Delivery App" },
  { value: "ALL", label: "All Modules (Default)" },
]

const emptyItem = () => ({
  icon: "description",
  title: "",
  description: "",
  content: "",
  color: "",
  bgColor: "",
  enabled: true,
})

const EMPTY_SUPPORT = {
  heroTitle: "",
  heroSubtitle: "",
  quickHelp: [],
  contact: { phone: "", email: "", chatAvailability: "" },
  supportInfo: [],
  footerTitle: "",
  footerSubtitle: "",
}

/** The API may return items without every key; fill the gaps so inputs stay controlled. */
const normalizeItem = (raw, idx) => ({
  ...emptyItem(),
  ...raw,
  icon: raw?.icon || "description",
  title: raw?.title ?? "",
  description: raw?.description ?? "",
  content: raw?.content ?? "",
  order: Number.isFinite(Number(raw?.order)) ? Number(raw.order) : idx,
  enabled: raw?.enabled !== false,
})

const normalizeSupport = (raw) => ({
  ...EMPTY_SUPPORT,
  ...raw,
  heroTitle: raw?.heroTitle ?? "",
  heroSubtitle: raw?.heroSubtitle ?? "",
  quickHelp: (Array.isArray(raw?.quickHelp) ? raw.quickHelp : []).map(normalizeItem),
  contact: {
    phone: raw?.contact?.phone ?? "",
    email: raw?.contact?.email ?? "",
    chatAvailability: raw?.contact?.chatAvailability ?? "",
  },
  supportInfo: (Array.isArray(raw?.supportInfo) ? raw.supportInfo : []).map(normalizeItem),
  footerTitle: raw?.footerTitle ?? "",
  footerSubtitle: raw?.footerSubtitle ?? "",
})

const inputClass =
  "bg-white border border-slate-300 text-slate-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5 outline-none"

const labelClass = "text-sm font-medium text-slate-700"

function Field({ id, label, hint, children }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  )
}

/**
 * Editor for one repeatable list (Quick Help or Support Information).
 *
 * Order is the array order — the backend renumbers `order` on write and the
 * apps sort by it, so moving a card up here moves it up in the app.
 */
function ItemListEditor({ title, description, items, onChange, showContent }) {
  const update = (idx, patch) =>
    onChange(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)))

  const remove = (idx) => onChange(items.filter((_, i) => i !== idx))

  const move = (idx, delta) => {
    const target = idx + delta
    if (target < 0 || target >= items.length) return
    const next = [...items]
    ;[next[idx], next[target]] = [next[target], next[idx]]
    onChange(next)
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 mb-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <p className="text-sm text-slate-600 mt-1">{description}</p>
        </div>
        <button
          type="button"
          onClick={() => onChange([...items, emptyItem()])}
          className="shrink-0 px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors text-sm font-medium"
        >
          + Add item
        </button>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-slate-500 border border-dashed border-slate-300 rounded-lg p-6 text-center">
          No items. This section is hidden in the app until you add one.
        </p>
      ) : (
        <div className="space-y-4">
          {items.map((item, idx) => (
            <div
              key={idx}
              className={`rounded-lg border p-4 ${
                item.enabled ? "border-slate-200 bg-slate-50" : "border-slate-200 bg-slate-100 opacity-60"
              }`}
            >
              <div className="flex items-center justify-between gap-3 mb-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Item {idx + 1}
                </span>
                <div className="flex items-center gap-1">
                  <label className="flex items-center gap-1.5 mr-2 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={item.enabled}
                      onChange={(e) => update(idx, { enabled: e.target.checked })}
                      className="rounded border-slate-300"
                    />
                    Visible
                  </label>
                  <button
                    type="button"
                    onClick={() => move(idx, -1)}
                    disabled={idx === 0}
                    title="Move up"
                    className="px-2 py-1 text-sm rounded border border-slate-300 bg-white disabled:opacity-40"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => move(idx, 1)}
                    disabled={idx === items.length - 1}
                    title="Move down"
                    className="px-2 py-1 text-sm rounded border border-slate-300 bg-white disabled:opacity-40"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(idx)}
                    title="Remove"
                    className="px-2 py-1 text-sm rounded border border-red-200 bg-white text-red-600 hover:bg-red-50"
                  >
                    Remove
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Field id={`icon-${title}-${idx}`} label="Icon">
                  <select
                    id={`icon-${title}-${idx}`}
                    value={item.icon}
                    onChange={(e) => update(idx, { icon: e.target.value })}
                    className={inputClass}
                  >
                    {ICON_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                    {/* Preserve an unrecognised value rather than silently changing it. */}
                    {ICON_OPTIONS.every((o) => o.value !== item.icon) && (
                      <option value={item.icon}>{item.icon} (unknown — shows a generic icon)</option>
                    )}
                  </select>
                </Field>

                <div className="md:col-span-2">
                  <Field id={`title-${title}-${idx}`} label="Title">
                    <input
                      id={`title-${title}-${idx}`}
                      type="text"
                      value={item.title}
                      onChange={(e) => update(idx, { title: e.target.value })}
                      placeholder="FAQs"
                      className={inputClass}
                    />
                  </Field>
                </div>

                <div className="md:col-span-3">
                  <Field
                    id={`desc-${title}-${idx}`}
                    label="Description"
                    hint="The one-line subtitle shown under the title."
                  >
                    <input
                      id={`desc-${title}-${idx}`}
                      type="text"
                      value={item.description}
                      onChange={(e) => update(idx, { description: e.target.value })}
                      placeholder="Find answers to common questions"
                      className={inputClass}
                    />
                  </Field>
                </div>

                {showContent && (
                  <div className="md:col-span-3">
                    <Field
                      id={`content-${title}-${idx}`}
                      label="Expanded content (optional)"
                      hint="Shown when the user taps this item. Leave blank for a non-expanding row."
                    >
                      <textarea
                        id={`content-${title}-${idx}`}
                        value={item.content}
                        onChange={(e) => update(idx, { content: e.target.value })}
                        rows={3}
                        placeholder="Browse our answers on ordering, payments and delivery times."
                        className={`${inputClass} resize-y`}
                      />
                    </Field>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Approximates how the mobile Help & Support screen renders the current values. */
function AppPreview({ data }) {
  const visible = (items) => items.filter((i) => i.enabled !== false)
  const quickHelp = visible(data.quickHelp)
  const supportInfo = visible(data.supportInfo)
  const hasContact = Boolean(data.contact.phone || data.contact.email)

  return (
    <div className="mx-auto w-full max-w-sm rounded-2xl border border-slate-300 bg-slate-50 p-4 shadow-inner">
      <div className="text-center text-sm font-bold text-slate-900 pb-3 border-b border-slate-200">
        Help &amp; Support
      </div>

      <div className="mt-4 rounded-xl bg-white p-4 shadow-sm">
        <p className="text-base font-bold text-slate-900">
          {data.heroTitle || <span className="text-slate-400">Hero title…</span>}
        </p>
        <p className="mt-1 text-xs text-slate-600">
          {data.heroSubtitle || <span className="text-slate-400">Hero subtitle…</span>}
        </p>
      </div>

      {quickHelp.length > 0 && (
        <>
          <p className="mt-5 mb-2 text-sm font-bold text-slate-900">Quick Help</p>
          <div className="rounded-xl bg-white shadow-sm divide-y divide-slate-100">
            {quickHelp.map((i, idx) => (
              <div key={idx} className="flex items-start gap-3 p-3">
                <span className="text-lg leading-none">{ICON_GLYPH[i.icon] || "❔"}</span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900 truncate">{i.title || "Untitled"}</p>
                  <p className="text-xs text-slate-600">{i.description}</p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {hasContact && (
        <>
          <p className="mt-5 mb-2 text-sm font-bold text-slate-900">Contact Us</p>
          <div className="rounded-xl bg-white p-3 shadow-sm space-y-2">
            {data.contact.phone && (
              <p className="text-sm text-slate-800">
                📞 {data.contact.phone}
                {data.contact.chatAvailability ? (
                  <span className="block text-xs text-slate-500">{data.contact.chatAvailability}</span>
                ) : null}
              </p>
            )}
            {data.contact.email && <p className="text-sm text-slate-800">✉️ {data.contact.email}</p>}
          </div>
        </>
      )}

      {supportInfo.length > 0 && (
        <>
          <p className="mt-5 mb-2 text-sm font-bold text-slate-900">Support Information</p>
          <div className="rounded-xl bg-white shadow-sm divide-y divide-slate-100">
            {supportInfo.map((i, idx) => (
              <div key={idx} className="flex items-start gap-3 p-3">
                <span className="text-lg leading-none">{ICON_GLYPH[i.icon] || "❔"}</span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900 truncate">{i.title || "Untitled"}</p>
                  <p className="text-xs text-slate-600">{i.description}</p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="mt-6 text-center">
        <p className="text-base">❤️</p>
        {data.footerTitle && <p className="text-xs font-bold text-slate-900">{data.footerTitle}</p>}
        {data.footerSubtitle && <p className="text-xs text-slate-500">{data.footerSubtitle}</p>}
      </div>
    </div>
  )
}

export default function SupportCMS() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [viewMode, setViewMode] = useState("edit") // "edit" | "preview"
  const [selectedModule, setSelectedModule] = useState("USER")
  const [data, setData] = useState(EMPTY_SUPPORT)

  const fetchSupportData = useCallback(async () => {
    try {
      setLoading(true)
      const response = await api.get(`${API_ENDPOINTS.ADMIN.SUPPORT}?module=${selectedModule}`, {
        contextModule: "admin",
      })
      setData(normalizeSupport(response.data?.success ? response.data.data : null))
    } catch (error) {
      debugError(error)
      if (error.response?.status === 404) {
        setData(EMPTY_SUPPORT)
      } else {
        toast.error("Failed to load support content")
      }
    } finally {
      setLoading(false)
    }
  }, [selectedModule])

  useEffect(() => {
    fetchSupportData()
  }, [fetchSupportData])

  const set = (patch) => setData((prev) => ({ ...prev, ...patch }))
  const setContact = (patch) => setData((prev) => ({ ...prev, contact: { ...prev.contact, ...patch } }))

  const handleSubmit = async () => {
    const email = String(data.contact.email || "").trim().toLowerCase()
    const phone = String(data.contact.phone || "").trim()

    if (email && (!SUPPORT_EMAIL_REGEX.test(email) || hasSuspiciousEmailTld(email))) {
      toast.error("Please enter a valid support email address")
      return
    }
    if (phone && !INDIAN_MOBILE_REGEX.test(phone)) {
      toast.error("Please enter a valid 10-digit Indian mobile number")
      return
    }
    const untitled = [...data.quickHelp, ...data.supportInfo].some((i) => !i.title.trim())
    if (untitled) {
      toast.error("Every item needs a title")
      return
    }

    try {
      setSaving(true)
      // Sending the structured keys is what tells the backend this is a full
      // write rather than the old flat {title, content, email, mobile} shape
      // it merges instead of replacing.
      const response = await api.put(
        API_ENDPOINTS.ADMIN.SUPPORT,
        {
          module: selectedModule,
          heroTitle: data.heroTitle,
          heroSubtitle: data.heroSubtitle,
          quickHelp: data.quickHelp.map((it, order) => ({ ...it, order })),
          contact: { phone, email, chatAvailability: data.contact.chatAvailability },
          supportInfo: data.supportInfo.map((it, order) => ({ ...it, order })),
          footerTitle: data.footerTitle,
          footerSubtitle: data.footerSubtitle,
        },
        { contextModule: "admin" },
      )
      if (response.data?.success) {
        toast.success(`${selectedModule} support content saved`)
        setData(normalizeSupport(response.data.data))
      }
    } catch (error) {
      debugError(error)
      toast.error(error.response?.data?.message || "Failed to save support content")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="h-full overflow-y-auto bg-slate-50 p-4 lg:p-6 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-slate-600">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-50 p-4 lg:p-6">
      <div className="max-w-6xl mx-auto pb-10">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Help &amp; Support</h1>
            <p className="text-sm text-slate-600 mt-1">
              Everything on the Help &amp; Support screen of each app is edited here.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
              <button
                type="button"
                onClick={() => setViewMode("edit")}
                className={`px-3 py-1.5 text-sm font-medium ${viewMode === "edit" ? "bg-slate-900 text-white" : "bg-white text-slate-700 hover:bg-slate-50"}`}
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => setViewMode("preview")}
                className={`px-3 py-1.5 text-sm font-medium ${viewMode === "preview" ? "bg-slate-900 text-white" : "bg-white text-slate-700 hover:bg-slate-50"}`}
              >
                Preview
              </button>
            </div>

            <label htmlFor="module-selector" className={labelClass}>
              Module:
            </label>
            <select
              id="module-selector"
              value={selectedModule}
              onChange={(e) => setSelectedModule(e.target.value)}
              className={inputClass}
            >
              {MODULES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          Editing the <span className="font-semibold">{selectedModule}</span> app. Each module has its own
          content — saving here does not affect the others.
        </div>

        {viewMode === "preview" ? (
          <AppPreview data={data} />
        ) : (
          <>
            <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 mb-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-1">Header</h2>
              <p className="text-sm text-slate-600 mb-4">The card at the top of the screen.</p>
              <div className="space-y-4">
                <Field id="hero-title" label="Hero title">
                  <input
                    id="hero-title"
                    type="text"
                    value={data.heroTitle}
                    onChange={(e) => set({ heroTitle: e.target.value })}
                    placeholder="We're here to help you!"
                    className={inputClass}
                  />
                </Field>
                <Field id="hero-subtitle" label="Hero subtitle">
                  <input
                    id="hero-subtitle"
                    type="text"
                    value={data.heroSubtitle}
                    onChange={(e) => set({ heroSubtitle: e.target.value })}
                    placeholder="Facing an issue? Our support team is ready to assist you."
                    className={inputClass}
                  />
                </Field>
              </div>
            </div>

            <ItemListEditor
              title="Quick Help"
              description="Tappable cards. Give an item expanded content and tapping it opens that text."
              items={data.quickHelp}
              onChange={(quickHelp) => set({ quickHelp })}
              showContent
            />

            <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 mb-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-1">Contact Us</h2>
              <p className="text-sm text-slate-600 mb-4">
                The phone number opens the dialer and the email opens the mail app. Leave both blank to hide
                this section.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Field id="contact-phone" label="Support phone" hint="10 digits, no country code.">
                  <input
                    id="contact-phone"
                    type="text"
                    inputMode="numeric"
                    value={data.contact.phone}
                    onChange={(e) => setContact({ phone: e.target.value.replace(/\D/g, "").slice(0, 10) })}
                    maxLength={10}
                    placeholder="6375095971"
                    className={inputClass}
                  />
                </Field>
                <Field id="contact-email" label="Support email">
                  <input
                    id="contact-email"
                    type="email"
                    value={data.contact.email}
                    onChange={(e) => setContact({ email: e.target.value })}
                    placeholder="support@dooriq.in"
                    className={inputClass}
                  />
                </Field>
                <Field id="contact-availability" label="Availability line" hint="Shown under the phone number.">
                  <input
                    id="contact-availability"
                    type="text"
                    value={data.contact.chatAvailability}
                    onChange={(e) => setContact({ chatAvailability: e.target.value })}
                    placeholder="Available 9AM - 9PM"
                    className={inputClass}
                  />
                </Field>
              </div>
            </div>

            <ItemListEditor
              title="Support Information"
              description="Read-only rows near the bottom — support hours, response time, and similar."
              items={data.supportInfo}
              onChange={(supportInfo) => set({ supportInfo })}
              showContent={false}
            />

            <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 mb-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-1">Footer</h2>
              <p className="text-sm text-slate-600 mb-4">The closing line under the heart icon.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field id="footer-title" label="Footer title">
                  <input
                    id="footer-title"
                    type="text"
                    value={data.footerTitle}
                    onChange={(e) => set({ footerTitle: e.target.value })}
                    placeholder="Thank you for choosing Dooriq!"
                    className={inputClass}
                  />
                </Field>
                <Field id="footer-subtitle" label="Footer subtitle">
                  <input
                    id="footer-subtitle"
                    type="text"
                    value={data.footerSubtitle}
                    onChange={(e) => set({ footerSubtitle: e.target.value })}
                    placeholder="We're always here to help you."
                    className={inputClass}
                  />
                </Field>
              </div>
            </div>
          </>
        )}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={fetchSupportData}
            disabled={saving}
            className="px-5 py-2.5 border border-slate-300 bg-white text-slate-700 rounded-lg hover:bg-slate-50 transition-colors font-medium disabled:opacity-50"
          >
            Discard changes
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Saving..." : `Save ${selectedModule} content`}
          </button>
        </div>
      </div>
    </div>
  )
}
