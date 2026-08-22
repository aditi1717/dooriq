import { useEffect, useState } from "react"
import { Save, Loader2, Gift } from "lucide-react"
import { Button } from "@food/components/ui/button"
import { adminAPI } from "@food/api"
import { toast } from "sonner"

const debugError = (...args) => {}

export default function ReferralSettings() {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [settings, setSettings] = useState({
    referralRewardUser: "",
    referredRewardUser: "",
    referralRewardDelivery: "",
    referredRewardDelivery: "",
    referralLimitUser: "",
    referralLimitDelivery: "",
    userAppStoreUrl: "",
    userPlayStoreUrl: "",
    deliveryAppStoreUrl: "",
    deliveryPlayStoreUrl: "",
  })

  const fetchSettings = async () => {
    try {
      setLoading(true)
      const res = await adminAPI.getReferralSettings()
      const s = res?.data?.data?.referralSettings
      if (res?.data?.success && s) {
        setSettings({
          referralRewardUser: s.referralRewardUser ?? "",
          referredRewardUser: s.referredRewardUser ?? "",
          referralRewardDelivery: s.referralRewardDelivery ?? "",
          referredRewardDelivery: s.referredRewardDelivery ?? "",
          referralLimitUser: s.referralLimitUser ?? "",
          referralLimitDelivery: s.referralLimitDelivery ?? "",
          userAppStoreUrl: s.userAppStoreUrl ?? "",
          userPlayStoreUrl: s.userPlayStoreUrl ?? "",
          deliveryAppStoreUrl: s.deliveryAppStoreUrl ?? "",
          deliveryPlayStoreUrl: s.deliveryPlayStoreUrl ?? "",
        })
      } else {
        setSettings({
          referralRewardUser: "",
          referredRewardUser: "",
          referralRewardDelivery: "",
          referredRewardDelivery: "",
          referralLimitUser: "",
          referralLimitDelivery: "",
          userAppStoreUrl: "",
          userPlayStoreUrl: "",
          deliveryAppStoreUrl: "",
          deliveryPlayStoreUrl: "",
        })
      }
    } catch (e) {
      debugError("Error fetching referral settings:", e)
      toast.error("Failed to load referral settings")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSettings()
  }, [])

  const handleSave = async () => {
    try {
      setSaving(true)
      const body = {
        referralRewardUser: settings.referralRewardUser === "" ? 0 : Number(settings.referralRewardUser),
        referredRewardUser: settings.referredRewardUser === "" ? 0 : Number(settings.referredRewardUser),
        referralRewardDelivery: settings.referralRewardDelivery === "" ? 0 : Number(settings.referralRewardDelivery),
        referredRewardDelivery: settings.referredRewardDelivery === "" ? 0 : Number(settings.referredRewardDelivery),
        referralLimitUser: settings.referralLimitUser === "" ? 0 : Number(settings.referralLimitUser),
        referralLimitDelivery: settings.referralLimitDelivery === "" ? 0 : Number(settings.referralLimitDelivery),
        userAppStoreUrl: settings.userAppStoreUrl.trim(),
        userPlayStoreUrl: settings.userPlayStoreUrl.trim(),
        deliveryAppStoreUrl: settings.deliveryAppStoreUrl.trim(),
        deliveryPlayStoreUrl: settings.deliveryPlayStoreUrl.trim(),
        isActive: true,
      }
      const res = await adminAPI.createOrUpdateReferralSettings(body)
      if (res?.data?.success) {
        toast.success("Referral settings saved successfully")
        const saved = res?.data?.data?.referralSettings
        if (saved) {
          setSettings({
            referralRewardUser: saved.referralRewardUser ?? "",
            referredRewardUser: saved.referredRewardUser ?? "",
            referralRewardDelivery: saved.referralRewardDelivery ?? "",
            referredRewardDelivery: saved.referredRewardDelivery ?? "",
            referralLimitUser: saved.referralLimitUser ?? "",
            referralLimitDelivery: saved.referralLimitDelivery ?? "",
            userAppStoreUrl: saved.userAppStoreUrl ?? "",
            userPlayStoreUrl: saved.userPlayStoreUrl ?? "",
            deliveryAppStoreUrl: saved.deliveryAppStoreUrl ?? "",
            deliveryPlayStoreUrl: saved.deliveryPlayStoreUrl ?? "",
          })
        }
      } else {
        toast.error(res?.data?.message || "Failed to save referral settings")
      }
    } catch (e) {
      debugError("Error saving referral settings:", e)
      toast.error(e?.response?.data?.message || "Failed to save referral settings")
    } finally {
      setSaving(false)
    }
  }

  const onChangeNumeric = (key) => (e) => {
    const v = String(e.target.value ?? "")
      .replace(/[^\d.]/g, "")
      .replace(/^0+(\d)/, "$1")
    setSettings((prev) => ({ ...prev, [key]: v }))
  }

  const onChangeText = (key) => (e) => {
    const v = String(e.target.value ?? "")
    setSettings((prev) => ({ ...prev, [key]: v }))
  }

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center">
            <Gift className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Referral Settings</h1>
        </div>
        <p className="text-sm text-slate-600">
          Configure distinct referral reward amounts for referrers and referred users/captains, plus maximum credits per referrer.
        </p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Configuration</h2>
              <p className="text-sm text-slate-500 mt-1">
                These values apply instantly to new referrals.
              </p>
            </div>
            <Button
              onClick={handleSave}
              disabled={saving || loading}
              className="bg-orange-600 hover:bg-orange-700 text-white flex items-center gap-2"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Save Settings
                </>
              )}
            </Button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-orange-600" />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* User Referral Card */}
              <div className="border border-slate-200 rounded-xl p-5 bg-slate-50/50">
                <div className="flex items-center gap-2 mb-4 border-b border-slate-200 pb-3">
                  <div className="w-3 h-3 rounded-full bg-orange-500" />
                  <h3 className="font-bold text-slate-900 text-base">User Referral Program</h3>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                      Referrer User Amount (₹)
                    </label>
                    <p className="text-[11px] text-slate-500 mb-1">Credited to existing user who shares their invite code</p>
                    <input
                      value={settings.referralRewardUser}
                      onChange={onChangeNumeric("referralRewardUser")}
                      inputMode="numeric"
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white font-semibold"
                      placeholder="e.g. 50"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                      Referred User Amount (₹)
                    </label>
                    <p className="text-[11px] text-slate-500 mb-1">Credited to new user who registers using an invite code</p>
                    <input
                      value={settings.referredRewardUser}
                      onChange={onChangeNumeric("referredRewardUser")}
                      inputMode="numeric"
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white font-semibold"
                      placeholder="e.g. 25"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                      Max Referral Limit per User
                    </label>
                    <p className="text-[11px] text-slate-500 mb-1">Maximum number of referrals a user can make (0 for unlimited)</p>
                    <input
                      value={settings.referralLimitUser}
                      onChange={onChangeNumeric("referralLimitUser")}
                      inputMode="numeric"
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white font-semibold"
                      placeholder="e.g. 5 (0 for unlimited)"
                    />
                  </div>

                  <div className="pt-2 border-t border-slate-200">
                    <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                      User App - Google Play Store URL
                    </label>
                    <p className="text-[11px] text-slate-500 mb-1">Used on referral share & invite page for Android users</p>
                    <input
                      value={settings.userPlayStoreUrl}
                      onChange={onChangeText("userPlayStoreUrl")}
                      type="url"
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white font-medium"
                      placeholder="https://play.google.com/store/apps/details?id=com.dooriq.user"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                      User App - Apple App Store URL
                    </label>
                    <p className="text-[11px] text-slate-500 mb-1">Used on referral share & invite page for iOS users</p>
                    <input
                      value={settings.userAppStoreUrl}
                      onChange={onChangeText("userAppStoreUrl")}
                      type="url"
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white font-medium"
                      placeholder="https://apps.apple.com/app/id..."
                    />
                  </div>
                </div>
              </div>

              {/* Delivery Partner Referral Card */}
              <div className="border border-slate-200 rounded-xl p-5 bg-slate-50/50">
                <div className="flex items-center gap-2 mb-4 border-b border-slate-200 pb-3">
                  <div className="w-3 h-3 rounded-full bg-emerald-500" />
                  <h3 className="font-bold text-slate-900 text-base">Delivery Captain Referral Program</h3>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                      Referrer Captain Amount (₹)
                    </label>
                    <p className="text-[11px] text-slate-500 mb-1">Credited to existing captain who shares their invite code</p>
                    <input
                      value={settings.referralRewardDelivery}
                      onChange={onChangeNumeric("referralRewardDelivery")}
                      inputMode="numeric"
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white font-semibold"
                      placeholder="e.g. 500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                      Referred Captain Amount (₹)
                    </label>
                    <p className="text-[11px] text-slate-500 mb-1">Credited to new captain who registers using an invite code</p>
                    <input
                      value={settings.referredRewardDelivery}
                      onChange={onChangeNumeric("referredRewardDelivery")}
                      inputMode="numeric"
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white font-semibold"
                      placeholder="e.g. 200"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                      Max Referral Limit per Captain
                    </label>
                    <p className="text-[11px] text-slate-500 mb-1">Maximum number of referrals a captain can make (0 for unlimited)</p>
                    <input
                      value={settings.referralLimitDelivery}
                      onChange={onChangeNumeric("referralLimitDelivery")}
                      inputMode="numeric"
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white font-semibold"
                      placeholder="e.g. 10 (0 for unlimited)"
                    />
                  </div>

                  <div className="pt-2 border-t border-slate-200">
                    <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                      Delivery Captain App - Google Play Store URL
                    </label>
                    <p className="text-[11px] text-slate-500 mb-1">Used on referral share & invite page for Android captains</p>
                    <input
                      value={settings.deliveryPlayStoreUrl}
                      onChange={onChangeText("deliveryPlayStoreUrl")}
                      type="url"
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white font-medium"
                      placeholder="https://play.google.com/store/apps/details?id=com.dooriq.delivery"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                      Delivery Captain App - Apple App Store URL
                    </label>
                    <p className="text-[11px] text-slate-500 mb-1">Used on referral share & invite page for iOS captains</p>
                    <input
                      value={settings.deliveryAppStoreUrl}
                      onChange={onChangeText("deliveryAppStoreUrl")}
                      type="url"
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white font-medium"
                      placeholder="https://apps.apple.com/app/id..."
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

