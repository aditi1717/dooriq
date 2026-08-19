import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ChefHat, MapPin, Phone, 
  ChevronDown, ChevronUp, Package, 
  Navigation, CheckCircle2, Camera, Loader2, Image as ImageIcon
} from 'lucide-react';
import { ActionSlider } from '@/modules/DeliveryV2/components/ui/ActionSlider';
import { uploadAPI } from '@food/api';
import { toast } from 'sonner';
import { openCamera } from "@food/utils/imageUploadUtils";
import { openNavigation } from '@/modules/DeliveryV2/utils/navigation';
import { toast as navToast } from 'sonner';

/**
 * PickupActionModal - Unified White/Green Theme with Slider Actions.
 * Includes Bill Upload feature prior to pickup.
 */
export const PickupActionModal = ({ 
  order, 
  status, 
  isWithinRange, 
  distanceToTarget,
  eta,
  onReachedPickup, 
  onPickedUp,
  onMinimize
}) => {
  const [showItems, setShowItems] = useState(false);
  const [isUploadingBill, setIsUploadingBill] = useState(false);
  const [billImageUploaded, setBillImageUploaded] = useState(false);
  const [billImageUrl, setBillImageUrl] = useState(null);
  const cameraInputRef = useRef(null);

  if (!order) return null;

  const handleBillImageSelect = async (file) => {
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image size should be less than 5MB');
      return;
    }

    setIsUploadingBill(true);
    try {
      const res = await uploadAPI.uploadMedia(file, { folder: 'dooriq/delivery/bills' });
      if (res?.data?.success && res?.data?.data) {
        setBillImageUrl(res.data.data.url || res.data.data.secure_url);
        setBillImageUploaded(true);
        // toast.success('Bill image uploaded!');
      } else {
        throw new Error('Upload failed');
      }
    } catch (err) {
      toast.error('Failed to upload bill image');
      setBillImageUploaded(false);
      setBillImageUrl(null);
    } finally {
      setIsUploadingBill(false);
    }
  };

  const handleTakeCameraPhoto = () => {
    openCamera({
      onSelectFile: (file) => handleBillImageSelect(file),
      fileNamePrefix: `bill-${order.orderId || order._id}`
    })
  }

  const handlePickFromGallery = () => {
    cameraInputRef.current?.click()
  }

  const isAtPickup = status === 'REACHED_PICKUP';
  const restaurantName =
    order.restaurantName ||
    order.restaurant_name ||
    order.restaurant?.restaurantName ||
    order.restaurant?.name ||
    order.restaurantId?.restaurantName ||
    order.restaurantId?.name ||
    'Restaurant';
  const restaurantAddress =
    order.restaurantAddress ||
    order.restaurant_address ||
    order.restaurant?.addressLine1 ||
    order.restaurant?.location?.address ||
    order.restaurantId?.addressLine1 ||
    order.restaurantId?.location?.address ||
    order.restaurantLocation?.address ||
    'Address not available';
  // Exact pickup point. Navigating by coordinates beats resolving an address
  // string, which in dense areas lands on the wrong building or branch.
  const restaurantPoint =
    order.restaurantLocation ||
    order.restaurantId?.location ||
    order.restaurant?.location ||
    null;
  const restaurantPhone =
    order.restaurantPhone ||
    order.restaurant_phone ||
    order.restaurant?.phone ||
    order.restaurant?.primaryContactNumber ||
    order.restaurant?.ownerPhone ||
    order.restaurantId?.phone ||
    order.restaurantId?.primaryContactNumber ||
    order.restaurantId?.ownerPhone ||
    '';
  const items = order.items || [];
  const restaurantLogo = order.restaurantImage || order.restaurant?.logo || order.restaurant?.profileImage || 'https://cdn-icons-png.flaticon.com/512/3170/3170733.png';

  return (
    <div className="absolute inset-0 z-[110] flex items-end justify-center">
      {/* Background Dim */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm -z-10"
      />

      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="w-full max-w-lg bg-white rounded-t-[3.5rem] shadow-[0_-25px_80px_rgba(0,0,0,0.5)] flex flex-col max-h-[88vh] overflow-hidden"
      >
        {/* Handle / Minimize */}
        <div className="w-full flex justify-center py-3 bg-white relative z-20">
          <button 
            onClick={onMinimize} 
            className="w-12 h-1.5 bg-gray-200 rounded-full hover:bg-gray-300 transition-colors active:scale-95"
            aria-label="Minimize"
          />
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar">
          {/* Restaurant Header */}
          <div className="p-8 pb-6">
            <div className="flex items-start justify-between mb-6 pb-6 border-b border-gray-50">
              <div className="flex gap-4">
                <div className="w-16 h-16 bg-white rounded-[1.5rem] flex items-center justify-center shadow-xl shadow-black/5 overflow-hidden border border-gray-100 ring-4 ring-gray-50">
                  <img src={restaurantLogo} alt="Logo" className="w-full h-full object-cover" />
                </div>
                <div>
                  <h3 className="text-gray-950 text-2xl font-black tracking-tight leading-none mb-1.5">{restaurantName}</h3>
                  <p className="text-gray-400 text-[10px] font-black uppercase tracking-widest mb-2.5">Order #{order?.shortId || order?.orderId || order?._id?.slice(-6) || 'N/A'}</p>
                  <div className="flex items-center gap-2">
                    {isAtPickup ? (
                      <div className="bg-emerald-50 px-3 py-1 rounded-full border border-emerald-100">
                        <span className="text-emerald-600 text-[10px] font-black uppercase tracking-widest">At Restaurant</span>
                      </div>
                    ) : (
                      <div className="bg-orange-50 px-3 py-1 rounded-full border border-orange-100 flex items-center gap-1.5">
                        <Phone className="w-3 h-3 text-orange-600" />
                        <span className="text-orange-600 text-[10px] font-black uppercase tracking-widest">
                          {restaurantPhone || 'N/A'}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex gap-2.5">
                {restaurantPhone && (
                  <button
                    onClick={() => window.location.href = `tel:${restaurantPhone}`}
                    className="w-11 h-11 rounded-2xl bg-emerald-50 flex items-center justify-center text-emerald-600 border border-emerald-100 hover:bg-emerald-100 transition-colors active:scale-90"
                  >
                    <Phone className="w-5 h-5" />
                  </button>
                )}
                <button 
                  onClick={() => {
                    const opened = openNavigation(restaurantPoint, restaurantAddress);
                    if (!opened) navToast.error('No pickup location available to navigate to.');
                  }}
                  className="w-11 h-11 rounded-2xl bg-gray-950 flex items-center justify-center text-white shadow-xl hover:bg-gray-800 transition-colors active:scale-90"
                >
                  <Navigation className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Content Area */}
            <div className="space-y-8">
              {/* Delivery Instructions (User Note) */}
              {order?.note && (
                <div className="bg-orange-50/50 border border-orange-100 rounded-[2rem] p-5 flex gap-4 items-start relative overflow-hidden group">
                  <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                    <ChefHat className="w-12 h-12 text-orange-500" />
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center shrink-0">
                    <ChefHat className="w-5 h-5 text-orange-600" />
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-orange-600 uppercase tracking-[0.2em] mb-1.5">User Note</p>
                    <p className="text-sm font-bold text-gray-800 leading-relaxed italic">"{order.note}"</p>
                  </div>
                </div>
              )}

              {/* Order Items Summary */}
              <div className="space-y-4">
                <button 
                  onClick={() => setShowItems(!showItems)}
                  className="w-full flex items-center justify-between p-5 bg-gray-50/80 rounded-[2rem] border border-gray-100 hover:bg-gray-100 transition-all group"
                >
                  <div className="flex items-center gap-4 text-gray-900">
                    <div className="w-10 h-10 rounded-xl bg-white shadow-sm flex items-center justify-center text-gray-400 group-hover:text-blue-500 transition-colors">
                      <Package className="w-5 h-5" />
                    </div>
                    <div className="text-left">
                      <span className="block text-[11px] font-black uppercase tracking-widest text-gray-400">Order Contents</span>
                      <span className="text-sm font-black tracking-tight">{items.length || 0} Items Reserved</span>
                    </div>
                  </div>
                  {showItems ? <ChevronDown className="w-5 h-5 text-gray-400" /> : <ChevronUp className="w-5 h-5 text-gray-400" />}
                </button>

                <AnimatePresence>
                  {showItems && (
                    <motion.div 
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden space-y-2 px-2"
                    >
                      {items.map((item, idx) => {
                        const name = item.name || item.foodName || item.title || 'Item Name';
                        const variant = item.variantName || item.variantTitle || item.selectedVariantName || item.selectedVariant?.name || (typeof item.variant === "string" ? item.variant : item.variant?.name) || item.size || "";
                        const displayName = variant ? `${name} (${variant})` : name;
                        return (
                          <div key={idx} className="flex justify-between items-center p-4 bg-gray-50/30 rounded-2xl border border-gray-50">
                            <span className="text-gray-800 text-sm font-bold uppercase tracking-tight">{displayName}</span>
                            <span className="text-emerald-700 font-black bg-emerald-100/50 px-3 py-1 rounded-xl text-xs">x{item.quantity || 1}</span>
                          </div>
                        );
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>

        {/* Action Sliders (Sticky Bottom) */}
        <div className="p-8 pt-0 pb-12 space-y-6 bg-white border-t border-gray-50">
          {!isAtPickup ? (
            <div className="pt-6">
              <p className={`text-center text-[10px] font-black uppercase tracking-[0.2em] mb-4 transition-colors ${
                isWithinRange ? 'text-emerald-600' : 'text-orange-500 animate-pulse'
              }`}>
                {isWithinRange ? 'Ready - Swipe to confirm arrival' : 'Get closer to restaurant'}
              </p>
              <ActionSlider 
                key="action-reach"
                label="Slide to Reach" 
                successLabel="Reached!"
                disabled={!isWithinRange}
                onConfirm={onReachedPickup}
                color="bg-emerald-600"
              />
            </div>
          ) : (
            <div className="pt-6">
              <p className="text-center text-[10px] font-black uppercase tracking-[0.2em] mb-4 text-emerald-600">
                Order Ready - Swipe to pick up
              </p>
              <ActionSlider 
                key="action-pickup"
                label="Slide to Pick Up" 
                successLabel="Picked Up!"
                disabled={false}
                onConfirm={() => onPickedUp(null)}
                color="bg-orange-500"
              />
            </div>
          )}
        </div>
      </motion.div>
    </div>

  );
};

export default PickupActionModal;
