import { useState, useRef, useMemo, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@food/components/ui/dialog";
import { Button } from "@food/components/ui/button";
import { Loader2, Upload, ExternalLink, Image as ImageIcon, Info } from "lucide-react";
import { userAPI } from "@food/api";
import { toast } from "sonner";

export default function RedeemCoinsModal({ open, onOpenChange, coinsInfo, onSuccess }) {
  const [loading, setLoading] = useState(false);
  const [screenshotFile, setScreenshotFile] = useState(null);
  const fileInputRef = useRef(null);
  const [isDragActive, setIsDragActive] = useState(false);

  const reviewUrl = coinsInfo?.settings?.reviewUrl || "https://play.google.com";

  const activeCoinBatches = useMemo(() => {
    if (!coinsInfo?.transactions || coinsInfo.transactions.length === 0) return [];

    const now = new Date();

    // 1. Calculate total redeemed/expired coins
    let totalDeductions = coinsInfo.transactions
      .filter((tx) => tx.type === "redeemed" || tx.type === "expired")
      .reduce((sum, tx) => sum + (tx.amount || 0), 0);

    // 2. Get earned transactions, sorted from oldest to newest
    const earnedTx = coinsInfo.transactions
      .filter((tx) => tx.type === "earned")
      .map((tx) => ({ ...tx })) // clone to avoid mutating original
      .sort((a, b) => new Date(a.createdAt || a.date) - new Date(b.createdAt || b.date));

    // 3. Apply deductions FIFO
    for (const tx of earnedTx) {
      if (totalDeductions > 0) {
        const deduct = Math.min(totalDeductions, tx.amount || 0);
        tx.amount -= deduct;
        totalDeductions -= deduct;
      }
    }

    // 4. Find all transactions with remaining amount that has not expired yet
    return earnedTx
      .filter((tx) => tx.amount > 0 && tx.expiresAt && new Date(tx.expiresAt) > now)
      .sort((a, b) => new Date(a.expiresAt) - new Date(b.expiresAt)); // earliest expiry first
  }, [coinsInfo]);

  const maxCoins = useMemo(() => {
    return activeCoinBatches.reduce((sum, batch) => sum + (batch.amount || 0), 0);
  }, [activeCoinBatches]);

  const [coinsToRedeem, setCoinsToRedeem] = useState(0);

  useEffect(() => {
    if (open) {
      setCoinsToRedeem(maxCoins);
    }
  }, [maxCoins, open]);

  const formatExpiryDate = (dateString) => {
    if (!dateString) return "";
    const date = new Date(dateString);
    return date.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragActive(true);
    } else if (e.type === "dragleave") {
      setIsDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith("image/")) {
        setScreenshotFile(file);
      } else {
        toast.error("Please upload an image file.");
      }
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setScreenshotFile(e.target.files[0]);
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  const handleSubmit = async () => {
    if (!coinsToRedeem || coinsToRedeem <= 0 || coinsToRedeem > maxCoins) {
      toast.error("Please enter a valid number of coins to redeem.");
      return;
    }
    if (!screenshotFile) {
      toast.error("Please upload a screenshot of your review.");
      return;
    }

    try {
      setLoading(true);

      // Upload screenshot
      const uploadRes = await userAPI.uploadGenericImage(screenshotFile);
      const screenshotUrl = uploadRes?.data?.data?.url || uploadRes?.data?.url;

      if (!screenshotUrl) throw new Error("Failed to upload screenshot");

      // Submit redemption
      await userAPI.submitCoinRedemption({
        coinsToRedeem,
        screenshotUrl,
      });

      toast.success("Redemption request submitted! Admin will verify soon.");
      onSuccess?.();
      onOpenChange(false);
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message || "Failed to submit request");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[450px] max-h-[90vh] p-0 overflow-hidden bg-white dark:bg-[#1a1a1a] flex flex-col">
        <div className="bg-amber-500 p-4 text-white text-center flex-shrink-0">
          <div className="w-12 h-12 bg-white/20 rounded-full mx-auto flex items-center justify-center mb-2">
            <span className="text-2xl">🪙</span>
          </div>
          <DialogTitle className="text-lg font-bold">Redeem Reward Coins</DialogTitle>
          <DialogDescription className="text-amber-100 text-xs mt-0.5">
            Exchange your valid coins for wallet balance
          </DialogDescription>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto flex-grow">
          <div className="bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300 p-3 rounded-lg text-xs flex gap-2">
            <Info className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold mb-0.5">How to redeem?</p>
              <ol className="list-decimal pl-4 space-y-0.5">
                <li>Rate & Review our app on the App Store/Play Store.</li>
                <li>Take a screenshot of your review.</li>
                <li>Upload it below to get wallet money!</li>
              </ol>
              <a
                href={reviewUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 mt-2 bg-blue-600 text-white px-2.5 py-1 rounded-md font-medium text-xs hover:bg-blue-700 transition-colors"
              >
                Go to Store <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">
              Coins to Redeem (Max: {maxCoins})
            </label>
            <input
              type="number"
              min="1"
              max={maxCoins}
              value={coinsToRedeem}
              onChange={(e) => setCoinsToRedeem(Number(e.target.value))}
              className="w-full h-10 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-[#0a0a0a] px-3 font-semibold text-base text-gray-900 dark:text-white focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none"
            />
            <p className="text-xs text-gray-500">
              You will get <strong className="text-green-600">₹{coinsToRedeem * (coinsInfo?.settings?.coinToWalletValue || 10)}</strong> in your wallet upon approval.
            </p>
            {activeCoinBatches.length > 0 && (
              <div className="mt-2.5 bg-amber-50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-900/30 p-2.5 rounded-lg flex flex-col gap-1">
                <p className="text-[10px] font-bold text-amber-850 dark:text-amber-300/90 uppercase tracking-wider mb-1 flex items-center gap-1">
                  <span>⏳</span> Coins Expiry Schedule (Oldest redeemed first)
                </p>
                <div className="flex flex-col gap-1 max-h-[80px] overflow-y-auto pr-1">
                  {activeCoinBatches.map((batch, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between text-[11px] text-amber-800 dark:text-amber-300 py-0.5 border-b border-amber-200/20 dark:border-amber-900/10 last:border-b-0"
                    >
                      <span className="truncate max-w-[220px]">🪙 <strong>{batch.amount}</strong> ({batch.description})</span>
                      <span className="font-semibold text-amber-700 dark:text-amber-400">Exp: {formatExpiryDate(batch.expiresAt)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">
              Upload Screenshot
            </label>
            <div
              onClick={triggerFileInput}
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors
                ${isDragActive ? "border-amber-500 bg-amber-50 dark:bg-amber-900/10" : "border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-[#0a0a0a]"}
              `}
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept="image/*"
                className="hidden"
              />
              {screenshotFile ? (
                <div className="flex flex-col items-center">
                  <div className="w-10 h-10 rounded-full bg-green-100 text-green-600 flex items-center justify-center mb-1.5">
                    <ImageIcon className="h-5 w-5" />
                  </div>
                  <p className="text-xs font-medium text-gray-900 dark:text-white truncate max-w-full">
                    {screenshotFile.name}
                  </p>
                  <p className="text-[11px] text-gray-500 mt-0.5">Click or drag to replace</p>
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 flex items-center justify-center mb-1.5">
                    <Upload className="h-5 w-5" />
                  </div>
                  <p className="text-xs font-medium text-gray-900 dark:text-white">
                    Click to upload or drag and drop
                  </p>
                  <p className="text-[11px] text-gray-500 mt-0.5">PNG, JPG up to 5MB</p>
                </div>
              )}
            </div>
          </div>

          <Button
            onClick={handleSubmit}
            disabled={loading || !screenshotFile || coinsToRedeem <= 0}
            className="w-full h-10 bg-amber-500 hover:bg-amber-600 text-white font-semibold text-sm rounded-lg transition-colors border-0 mt-2"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Submit Request
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
