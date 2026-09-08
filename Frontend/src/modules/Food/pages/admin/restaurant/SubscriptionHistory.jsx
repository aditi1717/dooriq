import { useEffect, useMemo, useState } from "react";
import { Search, RefreshCw } from "lucide-react";
import { adminAPI } from "@food/api";

export default function SubscriptionHistory() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await adminAPI.getRestaurantSubscriptionHistory({ limit: 200 });
      const data = Array.isArray(res?.data?.data?.items) ? res.data.data.items : [];
      setRows(data);
    } catch (_error) {
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      [row?.restaurantName, row?.ownerName, row?.ownerPhone, row?.subscriptionPlan]
        .map((v) => String(v || "").toLowerCase())
        .some((v) => v.includes(q))
    );
  }, [rows, search]);

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Subscription History</h1>
            <p className="text-sm text-slate-600 mt-1">
              View restaurant subscription plan, due, GMV and auto-deduction summary.
            </p>
          </div>
          <button
            type="button"
            onClick={fetchData}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-100"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>

        <div className="relative bg-white rounded-xl border border-slate-200 p-3">
          <Search className="w-4 h-4 text-slate-400 absolute left-6 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by restaurant, owner, phone or plan"
            className="w-full pl-10 pr-3 py-2 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Restaurant</th>
                <th className="text-left px-4 py-3 font-semibold">Owner</th>
                <th className="text-left px-4 py-3 font-semibold">Plan</th>
                <th className="text-right px-4 py-3 font-semibold">GMV (30d)</th>
                <th className="text-right px-4 py-3 font-semibold">Due</th>
                <th className="text-right px-4 py-3 font-semibold">Auto Deducted</th>
                <th className="text-left px-4 py-3 font-semibold">Status</th>
                <th className="text-left px-4 py-3 font-semibold">Valid Till</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="px-4 py-6 text-slate-500" colSpan={8}>Loading subscription history...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td className="px-4 py-6 text-slate-500" colSpan={8}>No records found.</td></tr>
              ) : filtered.map((row) => (
                <tr key={row?._id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium text-slate-900">{row?.restaurantName || "-"}</td>
                  <td className="px-4 py-3 text-slate-700">{row?.ownerName || "-"}</td>
                  <td className="px-4 py-3 uppercase text-slate-700">{row?.subscriptionPlan || "-"}</td>
                  <td className="px-4 py-3 text-right text-slate-800">₹{Number(row?.gmvLast30Days || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="px-4 py-3 text-right text-slate-800">₹{Number(row?.subscriptionDueAmount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="px-4 py-3 text-right text-slate-800">₹{Number(row?.totalAutoDeducted || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-semibold ${String(row?.subscriptionStatus || "").toLowerCase() === "due" ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
                      {row?.subscriptionStatus || "-"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{row?.subscriptionValidTill ? new Date(row.subscriptionValidTill).toLocaleDateString() : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

