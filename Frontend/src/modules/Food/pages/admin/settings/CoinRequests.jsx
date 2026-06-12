import { useEffect, useState } from "react";
import { Loader2, CheckCircle, XCircle, Search, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { adminAPI } from "@food/api";
import { format } from "date-fns";

export default function CoinRequests() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);
  const [filter, setFilter] = useState("all");

  const fetchRequests = async () => {
    try {
      setLoading(true);
      const params = {};
      if (filter !== "all") params.status = filter;
      const response = await adminAPI.getCoinRequests(params);
      const docs = response?.data?.data?.data || response?.data?.data?.docs || response?.data?.data || [];
      setRequests(Array.isArray(docs) ? docs : []);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load requests.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
  }, [filter]);

  const handleAction = async (id, status) => {
    const note = window.prompt(`Please enter an optional note for ${status} status:`);
    if (note === null) return; // cancelled

    try {
      setActionLoading(id);
      await adminAPI.verifyCoinRequest(id, { status, adminNote: note });
      toast.success(`Request ${status} successfully.`);
      fetchRequests();
    } catch (error) {
      toast.error(error?.response?.data?.message || `Failed to ${status} request.`);
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Redemption Requests</h1>
          <p className="text-sm text-gray-500 mt-1">Manage user reward coin redemption requests.</p>
        </div>
        
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-10 rounded-lg border border-slate-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">All Requests</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
              <tr>
                <th className="px-6 py-4">User</th>
                <th className="px-6 py-4">Coins Redeemed</th>
                <th className="px-6 py-4">Amount to Credit</th>
                <th className="px-6 py-4">Screenshot</th>
                <th className="px-6 py-4">Date</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan="7" className="px-6 py-12 text-center">
                    <Loader2 className="h-6 w-6 animate-spin text-slate-400 mx-auto" />
                  </td>
                </tr>
              ) : requests.length === 0 ? (
                <tr>
                  <td colSpan="7" className="px-6 py-12 text-center text-slate-500">
                    No redemption requests found.
                  </td>
                </tr>
              ) : (
                requests.map((req) => (
                  <tr key={req._id} className="hover:bg-slate-50">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-slate-200 flex-shrink-0 overflow-hidden">
                          {req.userId?.profileImage ? (
                            <img src={req.userId.profileImage} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <div className="h-full w-full flex items-center justify-center text-slate-500 font-semibold text-xs">
                              {req.userId?.name?.charAt(0) || "U"}
                            </div>
                          )}
                        </div>
                        <div>
                          <p className="font-medium text-slate-900">{req.userId?.name || "Unknown"}</p>
                          <p className="text-xs text-slate-500">{req.userId?.phone || req.userId?.email || ""}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 font-medium text-amber-600">{req.coinsRedeemed} Coins</td>
                    <td className="px-6 py-4 font-medium text-green-600">₹{req.amountToCredit}</td>
                    <td className="px-6 py-4">
                      <a
                        href={req.screenshotUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-800 text-xs font-medium bg-blue-50 px-2.5 py-1.5 rounded-md"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        View Image
                      </a>
                    </td>
                    <td className="px-6 py-4 text-slate-500">
                      {format(new Date(req.createdAt), "dd MMM yyyy, hh:mm a")}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium capitalize
                        ${req.status === 'approved' ? 'bg-green-100 text-green-800' : 
                          req.status === 'rejected' ? 'bg-red-100 text-red-800' : 
                          'bg-amber-100 text-amber-800'}`}
                      >
                        {req.status}
                      </span>
                      {req.adminNote && (
                        <p className="text-[11px] text-slate-500 mt-1 max-w-[150px] truncate" title={req.adminNote}>
                          Note: {req.adminNote}
                        </p>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right space-x-2">
                      {req.status === 'pending' && (
                        <>
                          <button
                            onClick={() => handleAction(req._id, 'approved')}
                            disabled={actionLoading === req._id}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 text-xs font-medium"
                          >
                            {actionLoading === req._id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
                            Approve
                          </button>
                          <button
                            onClick={() => handleAction(req._id, 'rejected')}
                            disabled={actionLoading === req._id}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-100 text-red-700 rounded-md hover:bg-red-200 disabled:opacity-50 text-xs font-medium"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            Reject
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
