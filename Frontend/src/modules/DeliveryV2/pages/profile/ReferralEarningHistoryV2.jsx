import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, Share2, Copy, Users, IndianRupee, 
  HelpCircle, Loader2, ArrowUpRight, Gift
} from 'lucide-react';
import { deliveryAPI } from '@food/api';
import { toast } from 'sonner';
import { formatCurrency } from '@food/utils/currency';
import useDeliveryBackNavigation from '../../hooks/useDeliveryBackNavigation';

export const ReferralEarningHistoryV2 = () => {
  const navigate = useNavigate();
  const goBack = useDeliveryBackNavigation();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    referralCount: 0,
    totalReferralEarnings: 0,
    rewardAmount: 0
  });
  const [history, setHistory] = useState([]);
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [profileRes, statsRes, walletRes] = await Promise.allSettled([
          deliveryAPI.getProfile(),
          deliveryAPI.getReferralStats(),
          deliveryAPI.getWallet()
        ]);

        if (profileRes.status === "fulfilled" && profileRes.value?.data?.data?.profile) {
          setProfile(profileRes.value.data.data.profile);
        }

        if (statsRes.status === "fulfilled" && statsRes.value?.data?.data?.stats) {
          setStats(statsRes.value.data.data.stats);
        }

        if (walletRes.status === "fulfilled") {
          const wallet = walletRes.value.value?.data?.data?.wallet || walletRes.value.value?.data?.wallet || {};
          const txs = wallet.transactions || [];
          // Filter transactions for referral rewards
          const referralTxs = txs.filter(tx => 
            /referral/i.test(tx?.description || '') || 
            /referral/i.test(tx?.reference || '') || 
            /referral/i.test(tx?.type || '')
          );
          setHistory(referralTxs);
        }
      } catch (err) {
        toast.error('Failed to load referral details');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const refId = profile?._id || profile?.id || profile?.referralCode || "";
  const referralLink = refId ? `${window.location.origin}/food/delivery/signup?ref=${encodeURIComponent(String(refId))}` : "";

  const handleCopyCode = () => {
    if (!refId) return;
    navigator.clipboard.writeText(refId);
    toast.success("Referral code copied!");
  };

  const handleShareReferral = async () => {
    if (!referralLink) return;
    const rewardText = stats.rewardAmount > 0 ? `₹${stats.rewardAmount}` : "rewards";
    const shareText = `Join as a delivery partner and earn ${rewardText}.`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Delivery Referral", text: shareText, url: referralLink });
      } else {
        const fallbackUrl = `https://wa.me/?text=${encodeURIComponent(`${shareText} ${referralLink}`)}`;
        window.open(fallbackUrl, "_blank", "noopener,noreferrer");
      }
    } catch (e) {
      // Ignore abort errors
    }
  };

  return (
    <div className="min-h-screen bg-[#f8f9fa] font-poppins pb-32">
      {/* Header */}
      <div className="fixed top-0 inset-x-0 h-20 bg-[#f8f9fa]/90 backdrop-blur-xl z-50 px-5 flex items-center justify-between pb-2 pt-6">
        <div className="flex items-center gap-3">
          <button onClick={goBack} className="p-3 bg-white hover:bg-gray-50 border border-gray-100 shadow-sm rounded-[20px] transition-all active:scale-95">
            <ArrowLeft className="w-5 h-5 text-gray-700" />
          </button>
          <h1 className="text-xl font-black text-gray-900 tracking-tight">Referral & Earn</h1>
        </div>
      </div>

      <div className="pt-24 px-5 space-y-5 max-w-lg mx-auto">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
            <p className="text-gray-400 text-[10px] font-black uppercase tracking-widest">Loading Referral Details...</p>
          </div>
        ) : (
          <>
            {/* Summary Grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white rounded-[24px] p-5 border border-gray-100 shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Total Earned</p>
                <h3 className="text-2xl font-black text-gray-900 mt-2">₹{(stats.totalReferralEarnings || 0).toFixed(2)}</h3>
              </div>
              <div className="bg-white rounded-[24px] p-5 border border-gray-100 shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Successful Invites</p>
                <h3 className="text-2xl font-black text-gray-900 mt-2">{stats.referralCount || 0}</h3>
              </div>
            </div>

            {/* Referral Info Card */}
            <div className="bg-white p-6 rounded-[32px] border border-gray-100 shadow-[0_8px_30px_rgba(0,0,0,0.03)] text-center space-y-4">
              <div className="w-12 h-12 rounded-[20px] bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
                <Gift className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-base font-black text-gray-900">Invite Friends, Earn Rewards</h4>
                <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                  For every new captain you onboard who successfully activates their account, you earn a reward of <span className="font-bold text-gray-800">₹{stats.rewardAmount}</span>.
                </p>
              </div>

              {/* Code Box */}
              {refId && (
                <div className="flex items-center justify-between gap-3 bg-gray-50 border border-gray-100 rounded-[20px] px-4 py-3 mt-4">
                  <div className="text-left">
                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Your Code</p>
                    <p className="text-sm font-black text-gray-800 tracking-wider mt-0.5">{refId.substring(0, 10).toUpperCase()}</p>
                  </div>
                  <button 
                    onClick={handleCopyCode}
                    className="p-2.5 bg-white hover:bg-gray-100 rounded-xl border border-gray-100 shadow-sm active:scale-95 transition-all text-gray-600"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* Share Button */}
              <button
                onClick={handleShareReferral}
                className="w-full py-4 rounded-[20px] text-white text-[11px] font-black uppercase tracking-widest flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
                style={{
                  background: "linear-gradient(135deg, rgba(var(--module-theme-rgb, 0,183,97), 0.88), var(--module-theme-color, #00B761))",
                  boxShadow: "0 8px 20px rgba(var(--module-theme-rgb, 0,183,97), 0.20)",
                }}
              >
                <Share2 className="w-4 h-4" />
                Invite Friends
              </button>
            </div>

            {/* Payout Redirect Link */}
            <button
              onClick={() => navigate("/food/delivery/pocket/balance")}
              className="w-full bg-[#111111] hover:bg-black text-white p-5 rounded-[28px] font-black text-xs uppercase tracking-widest flex items-center justify-between active:scale-[0.98] transition-transform shadow-[0_8px_24px_rgba(17,17,17,0.15)]"
            >
              <div className="text-left">
                <span className="block text-sm font-black tracking-normal">Withdraw Earnings</span>
                <span className="block text-[9px] font-bold opacity-60 mt-0.5 tracking-widest">Go to Wallet Withdrawal</span>
              </div>
              <ArrowUpRight className="w-5 h-5 text-gray-300" />
            </button>

            {/* History Section */}
            <div className="pt-2">
              <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] px-2 mb-3">Reward History</h3>
              {history.length === 0 ? (
                <div className="bg-white rounded-[32px] p-8 border border-gray-100 shadow-[0_4px_20px_rgba(0,0,0,0.02)] text-center">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">No referral rewards credited yet</p>
                </div>
              ) : (
                <div className="bg-white rounded-[32px] p-2 border border-gray-100 shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
                  <div className="px-2 divide-y divide-gray-50">
                    {history.map((tx, idx) => (
                      <div key={tx._id || idx} className="py-4 flex justify-between items-center">
                        <div>
                          <p className="text-sm font-black text-gray-900 leading-tight capitalize">
                            {tx.description || "Referral Bonus"}
                          </p>
                          <p className="text-[9px] font-bold text-gray-400 mt-1 uppercase tracking-widest">
                            {tx.createdAt ? new Date(tx.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ""}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-black text-emerald-600">
                            +{formatCurrency(tx.amount)}
                          </p>
                          <span className="text-[8px] font-black uppercase tracking-widest text-emerald-500 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100 mt-1 inline-block">
                            {tx.status || "Completed"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
