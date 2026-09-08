import { useState, useRef, useMemo, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@food/components/ui/dialog";
import { Button } from "@food/components/ui/button";
import { Loader2, Upload, ExternalLink, Image as ImageIcon, Info } from "lucide-react";
import { userAPI } from "@food/api";
import { toast } from "sonner";
import { isFlutterBridgeAvailable, openGallery } from "@food/utils/imageUploadUtils";

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
    const totalRefunded = coinsInfo.transactions
      .filter((tx) => tx.type === "refunded")
      .reduce((sum, tx) => sum + (tx.amount || 0), 0);

    let totalDeductions = Math.max(0,
      coinsInfo.transactions
        .filter((tx) => tx.type === "redeemed" || tx.type === "expired")
        .reduce((sum, tx) => sum + (tx.amount || 0), 0)
      - totalRefunded
    );

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

  const [coinsToRedeem, setCoinsToRedeem] = useState(1);

  useEffect(() => {
    if (open) {
      // Reset form to fresh state every time the modal opens
      setCoinsToRedeem(Math.max(1, maxCoins));
      setScreenshotFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [open, maxCoins]);

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

  const triggerFileInput = async () => {
    if (!isFlutterBridgeAvailable()) {
      fileInputRef.current?.click();
      return;
    }

    await openGallery({
      onSelectFile: (file) => {
        setScreenshotFile(file);
      },
      fileNamePrefix: "review-screenshot",
    });
  };

  const handleGoToStore = (e) => {
    e.preventDefault();
    if (isFlutterBridgeAvailable()) {
      window.flutter_inappwebview.callHandler("openUrl", { url: reviewUrl })
        .catch(() => {
          window.open(reviewUrl, "_blank");
        });
    } else {
      window.open(reviewUrl, "_blank");
    }
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
        <div 
          className="p-4 text-white text-center flex-shrink-0"
          style={{
            background: "linear-gradient(135deg, rgba(var(--module-theme-rgb, 250, 2, 114), 0.94), var(--module-theme-color))",
          }}
        >
          <div className="w-12 h-12 bg-white/20 rounded-full mx-auto flex items-center justify-center mb-2">
            <span className="text-2xl">🪙</span>
          </div>
          <DialogTitle className="text-lg font-bold">Redeem Reward Coins</DialogTitle>
          <DialogDescription className="text-white/80 text-xs mt-0.5">
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
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">
              Coins to Redeem (Max: {maxCoins})
            </label>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={coinsToRedeem}
              onChange={(e) => {
                const raw = e.target.value.replace(/[^0-9]/g, "")
                if (raw === "") { setCoinsToRedeem(""); return }
                const num = Math.min(Number(raw), maxCoins)
                setCoinsToRedeem(num < 1 ? 1 : num)
              }}
              onBlur={() => {
                if (!coinsToRedeem || Number(coinsToRedeem) < 1) setCoinsToRedeem(1)
              }}
              className="w-full h-10 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-[#0a0a0a] px-3 font-semibold text-base text-gray-900 dark:text-white focus:ring-2 focus:ring-[color:var(--module-theme-color)] focus:border-transparent outline-none"
            />
            <p className="text-xs text-gray-500">
              You will get <strong className="text-green-600">₹{(Number(coinsToRedeem) || 0) * (coinsInfo?.settings?.coinToWalletValue || 10)}</strong> in your wallet upon approval.
            </p>
            {activeCoinBatches.length > 0 && (
              <div 
                className="mt-2.5 p-2.5 rounded-lg flex flex-col gap-1 border"
                style={{
                  backgroundColor: "rgba(var(--module-theme-rgb, 250, 2, 114), 0.05)",
                  borderColor: "rgba(var(--module-theme-rgb, 250, 2, 114), 0.2)",
                }}
              >
                <p 
                  className="text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center gap-1"
                  style={{ color: "var(--module-theme-color)" }}
                >
                  <span>⏳</span> Coins Expiry Schedule (Oldest redeemed first)
                </p>
                <div className="flex flex-col gap-1 max-h-[80px] overflow-y-auto pr-1">
                  {activeCoinBatches.map((batch, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between text-[11px] py-0.5 border-b last:border-b-0"
                      style={{ borderColor: "rgba(var(--module-theme-rgb, 250, 2, 114), 0.12)" }}
                    >
                      <span className="truncate max-w-[220px] text-gray-800 dark:text-gray-200">🪙 <strong>{batch.amount}</strong> ({batch.description})</span>
                      <span className="font-semibold" style={{ color: "var(--module-theme-color)" }}>Exp: {formatExpiryDate(batch.expiresAt)}</span>
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
            <button
              type="button"
              onClick={triggerFileInput}
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              className={`w-full border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors
                ${isDragActive 
                  ? "bg-pink-50 dark:bg-pink-950/30 border-[color:var(--module-theme-color,#FA0272)]" 
                  : "border-gray-300 dark:border-slate-700 bg-gray-50/60 dark:bg-slate-900/70 hover:bg-gray-100 dark:hover:bg-slate-800/90"}
              `}
              style={isDragActive ? {
                borderColor: "var(--module-theme-color)",
                backgroundColor: "rgba(var(--module-theme-rgb, 250, 2, 114), 0.08)",
              } : undefined}
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".jpg,.jpeg,.png,.webp"
                className="hidden"
              />
              {screenshotFile ? (
                <div className="flex flex-col items-center">
                  <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-950/40 text-green-600 dark:text-green-400 flex items-center justify-center mb-1.5 border border-green-200 dark:border-green-800/40">
                    <ImageIcon className="h-5 w-5" />
                  </div>
                  <p className="text-xs font-medium text-gray-900 dark:text-white truncate max-w-full">
                    {screenshotFile.name}
                  </p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">Click or drag to replace</p>
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-300 flex items-center justify-center mb-1.5 border border-gray-200 dark:border-slate-700 shadow-sm">
                    <Upload className="h-5 w-5" />
                  </div>
                  <p className="text-xs font-semibold text-gray-900 dark:text-white">
                    Click to upload or drag and drop
                  </p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">PNG, JPG up to 5MB</p>
                </div>
              )}
            </button>
          </div>

          <Button
            onClick={handleSubmit}
            disabled={loading || !screenshotFile || coinsToRedeem <= 0}
            className="w-full h-10 text-white font-semibold text-sm rounded-lg transition-all border-0 mt-2 disabled:opacity-50"
            style={{
              background:
                "linear-gradient(135deg, rgba(var(--module-theme-rgb, 250, 2, 114), 0.94), var(--module-theme-color))",
              boxShadow:
                "0 8px 16px rgba(var(--module-theme-rgb, 250, 2, 114), 0.25)",
            }}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Submit Request
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
