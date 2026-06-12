import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { adminAPI } from "@food/api";

export default function CoinSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    isActive: true,
    minCoinsPerOrder: 1,
    maxCoinsPerOrder: 3,
    coinExpiryDays: 30,
    coinToWalletValue: 10,
    reviewUrl: ""
  });

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const response = await adminAPI.getCoinSettings();
        if (response?.data?.data) {
          setFormData(response.data.data);
        }
      } catch (error) {
        toast.error(error?.response?.data?.message || "Failed to load coin settings.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const payload = {
        isActive: formData.isActive,
        minCoinsPerOrder: Number(formData.minCoinsPerOrder),
        maxCoinsPerOrder: Number(formData.maxCoinsPerOrder),
        coinExpiryDays: Number(formData.coinExpiryDays),
        coinToWalletValue: Number(formData.coinToWalletValue),
        reviewUrl: formData.reviewUrl
      };
      
      const response = await adminAPI.updateCoinSettings(payload);
      if (response?.data?.data) {
        setFormData(response.data.data);
        toast.success("Coin settings updated successfully.");
      }
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to update coin settings.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-[320px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Reward Coin Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Configure how users earn and redeem reward coins.</p>
      </div>

      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-6">
        <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
          <input
            type="checkbox"
            id="isActive"
            name="isActive"
            checked={formData.isActive}
            onChange={handleChange}
            className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <label htmlFor="isActive" className="text-sm font-semibold text-slate-800">
            Enable Reward Coin System
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">Min Coins Per Order</label>
            <input
              type="number"
              name="minCoinsPerOrder"
              min="0"
              value={formData.minCoinsPerOrder}
              onChange={handleChange}
              className="h-11 w-full rounded-md border border-slate-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">Max Coins Per Order</label>
            <input
              type="number"
              name="maxCoinsPerOrder"
              min="0"
              value={formData.maxCoinsPerOrder}
              onChange={handleChange}
              className="h-11 w-full rounded-md border border-slate-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">Coin Expiry (Days)</label>
            <input
              type="number"
              name="coinExpiryDays"
              min="1"
              value={formData.coinExpiryDays}
              onChange={handleChange}
              className="h-11 w-full rounded-md border border-slate-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">Wallet Value (Per Coin)</label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-gray-500">₹</span>
              <input
                type="number"
                name="coinToWalletValue"
                min="0"
                value={formData.coinToWalletValue}
                onChange={handleChange}
                className="h-11 w-full rounded-md border border-slate-300 pl-7 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <p className="text-xs text-gray-500">Amount to credit to user wallet for 1 redeemed coin.</p>
          </div>

          <div className="space-y-2 md:col-span-2">
            <label className="block text-sm font-medium text-gray-700">App Review URL</label>
            <input
              type="url"
              name="reviewUrl"
              value={formData.reviewUrl}
              onChange={handleChange}
              placeholder="https://play.google.com/store/apps/details?id=com.your.app"
              className="h-11 w-full rounded-md border border-slate-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save Settings
        </button>
      </div>
    </div>
  );
}
