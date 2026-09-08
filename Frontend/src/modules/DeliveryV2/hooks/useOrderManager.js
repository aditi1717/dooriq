import { useDeliveryStore } from '@/modules/DeliveryV2/store/useDeliveryStore';
import { deliveryAPI } from '@food/api';
import { toast } from 'sonner';

const canonicalOrderId = (order) =>
  order?.orderMongoId || order?._id || order?.orderId || order?.id || null;

const normalizeId = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return String(value?._id || value?.id || value);
};

const safeReadJson = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch (_) {
    return null;
  }
};

const decodeJwtPayload = (token) => {
  try {
    const [, body] = String(token || '').split('.');
    if (!body) return null;
    const json = atob(body.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json);
  } catch (_) {
    return null;
  }
};

const getStoredDeliveryPartnerId = () => {
  if (typeof localStorage === 'undefined') return '';

  const directId =
    localStorage.getItem('deliveryPartnerId') ||
    localStorage.getItem('deliveryPartnerMongoId') ||
    localStorage.getItem('deliveryBoyId') ||
    '';
  if (directId) return String(directId);

  const storedUser =
    safeReadJson('delivery_user') ||
    safeReadJson('deliveryUser') ||
    safeReadJson('user') ||
    {};
  const userId =
    storedUser?._id ||
    storedUser?.id ||
    storedUser?.userId ||
    storedUser?.deliveryPartnerId ||
    storedUser?.deliveryPartner?._id ||
    storedUser?.deliveryPartner?.id;
  if (userId) return String(userId);

  const token =
    localStorage.getItem('delivery_accessToken') ||
    localStorage.getItem('accessToken') ||
    '';
  const payload = decodeJwtPayload(token);
  return String(payload?.userId || payload?.id || payload?._id || payload?.sub || '');
};

const getAcceptedDeliveryPartnerId = (order) =>
  normalizeId(
    order?.acceptedDeliveryPartnerId ||
      order?.dispatch?.deliveryPartnerId ||
      order?.deliveryPartnerId ||
      order?.deliveryPartner?._id ||
      order?.deliveryPartner?.id,
  );

/**
 * useOrderManager - Professional hook for real-world trip lifecycle actions.
 * Connects directly to the backend API services.
 */
export const useOrderManager = () => {
  const { 
    activeOrder, tripStatus, updateTripStatus, clearActiveOrder, setActiveOrder, riderLocation 
  } = useDeliveryStore();

  const acceptOrder = async (order) => {
    const orderId = canonicalOrderId(order);
    if (!orderId) {
      toast.error('Invalid order data');
      return;
    }

    try {
      const response = await deliveryAPI.acceptOrder(orderId);
      
      if (response?.data?.success) {
        const fullOrder = response.data.data?.order || order;
        const acceptedPartnerId = getAcceptedDeliveryPartnerId(fullOrder);
        const myPartnerId = getStoredDeliveryPartnerId();

        if (acceptedPartnerId && myPartnerId && String(acceptedPartnerId) !== String(myPartnerId)) {
          const raceError = new Error('Order already accepted by another rider');
          raceError.code = 'ORDER_CLAIMED_BY_OTHER';
          throw raceError;
        }
        
        // Robustly determine locations from multiple possible formats (Populated API vs Socket)
        const getLoc = (ref, keysLat, keysLng) => {
          if (!ref) return null;
          // Handle nested populated objects
          if (ref.location) {
            // Handle GeoJSON format: location: { type: 'Point', coordinates: [lng, lat] }
            if (Array.isArray(ref.location.coordinates) && ref.location.coordinates.length >= 2) {
              return {
                lat: ref.location.coordinates[1], // Latitude is second in GeoJSON [lng, lat]
                lng: ref.location.coordinates[0]  // Longitude is first
              };
            }
            // Handle standard object format: location: { latitude: 12.3, longitude: 45.6 }
            return {
              lat: ref.location.latitude || ref.location.lat,
              lng: ref.location.longitude || ref.location.lng
            };
          }
          // Handle flat objects or direct lat/lng keys
          for (const k of keysLat) { if (ref[k] != null) return { lat: ref[k], lng: ref[keysLng[keysLat.indexOf(k)]] }; }
          return null;
        };

        console.log('[OrderManager] Raw Full Order Data:', fullOrder);

        const resLoc = getLoc(fullOrder.restaurantId, ['latitude', 'lat'], ['longitude', 'lng']) || 
                       getLoc(fullOrder, ['restaurant_lat', 'restaurantLat', 'latitude'], ['restaurant_lng', 'restaurantLng', 'longitude']);
                       
        const cusLoc = getLoc(fullOrder.deliveryAddress, ['latitude', 'lat'], ['longitude', 'lng']) || 
                       getLoc(fullOrder, ['customer_lat', 'customerLat', 'latitude'], ['customer_lng', 'customerLng', 'longitude']);

        console.log('[OrderManager] Locations Mapped Result:', { resLoc, cusLoc });

        setActiveOrder({
          ...fullOrder,
          orderMongoId: fullOrder.orderMongoId || fullOrder._id || orderId,
          orderId: fullOrder.order_id || fullOrder.orderId || order?.orderId || orderId,
          displayOrderId: fullOrder.order_id || fullOrder.orderId || order?.orderId || null,
          restaurantLocation: resLoc,
          customerLocation: cusLoc
        });

        updateTripStatus('PICKING_UP');
        // toast.success('Order Accepted! Opening Map...');
      } else {
        toast.error(response?.data?.message || 'Order already taken or unavailable');
        throw new Error('Accept failed');
      }
    } catch (error) {
      console.error('Accept Order Error:', error);
      const status = error?.response?.status;
      const serverMessage = error?.response?.data?.message || '';
      const isClaimRace =
        error?.code === 'ORDER_CLAIMED_BY_OTHER' ||
        [403, 409, 422].includes(status) ||
        /already accepted|no longer available/i.test(serverMessage);
      toast.error(isClaimRace ? 'Order already accepted by another rider' : 'Network error. Please try again.');
      throw error;
    }
  };

  /**
   * Mark "Reached Pickup" (Arrival at restaurant)
   */
  const reachPickup = async () => {
    const orderId = canonicalOrderId(activeOrder);
    try {
      const response = await deliveryAPI.confirmReachedPickup(orderId);
      if (response?.data?.success) {
        updateTripStatus('REACHED_PICKUP');
        // toast.info('Arrived at Restaurant');
      } else {
        throw new Error('Confirm pickup failed');
      }
    } catch (error) {
      toast.error('Failed to update status');
      throw error;
    }
  };

  /**
   * Mark "Picked Up" (Confirm order ID & start delivery)
   */
  const pickUpOrder = async (billImageUrl) => {
    const orderId = canonicalOrderId(activeOrder);
    try {
      // confirmOrderId(orderId, confirmedOrderId, location, data)
      const response = await deliveryAPI.confirmOrderId(
        orderId, 
        activeOrder.displayOrderId || orderId, 
        riderLocation || {},
        { billImageUrl }
      );
      
      if (response?.data?.success) {
        updateTripStatus('PICKED_UP');
        // toast.success('Order Collected! Heading to Drop-off');
      } else {
        throw new Error('Confirm order ID failed');
      }
    } catch (error) {
      toast.error('Error confirming pickup');
      throw error;
    }
  };

  /**
   * Mark "Reached Drop" (Arrival at customer)
   */
  const reachDrop = async () => {
    const orderId = canonicalOrderId(activeOrder);
    try {
      const response = await deliveryAPI.confirmReachedDrop(orderId);
      if (response?.data?.success) {
        updateTripStatus('REACHED_DROP');
        // toast.info('Arrived at Customer Location');
      } else {
        throw new Error('Confirm drop failed');
      }
    } catch (error) {
      toast.error('Failed to notify arrival');
      throw error;
    }
  };

  /**
   * Finalize Delivery with OTP Check
   */
  const completeDelivery = async (otp) => {
    const orderId = canonicalOrderId(activeOrder);
    try {
      const paymentMethod = (
        activeOrder?.paymentMethod ||
        activeOrder?.payment?.method ||
        activeOrder?.transaction?.payment?.method ||
        activeOrder?.transaction?.paymentMethod ||
        'cod'
      ).toLowerCase();
      const isCod = ['cash', 'cod', 'cash_on_delivery', 'razorpay_qr'].includes(paymentMethod);

      let finalOrder = activeOrder;

      if (isCod) {
        // Direct complete without OTP verification for COD orders
        const completeRes = await deliveryAPI.completeDelivery(orderId, { rating: 5 });
        if (completeRes.data?.success && completeRes.data?.data?.order) {
          finalOrder = completeRes.data.data.order;
        } else {
          toast.error(completeRes.data?.message || 'Failed to complete delivery on server');
          throw new Error('Complete call failed');
        }
      } else {
        // 1. Verify OTP first for online payment orders
        const verifyRes = await deliveryAPI.verifyDropOtp(orderId, otp);
        
        if (verifyRes?.data?.success) {
          finalOrder = verifyRes.data?.data?.order || activeOrder;
          
          // 2. Mark as complete
          const completeRes = await deliveryAPI.completeDelivery(orderId, { otp, rating: 5 });
          if (completeRes.data?.success && completeRes.data?.data?.order) {
            finalOrder = completeRes.data.data.order;
          } else {
            toast.error(completeRes.data?.message || 'Failed to complete delivery on server');
            throw new Error('Complete call failed');
          }
        } else {
          toast.error('Invalid OTP. Please check with customer.');
          throw new Error('Invalid OTP');
        }
      }

      // Update local order state so Summary Modal shows 'delivered' status
      if (finalOrder) setActiveOrder(finalOrder);
      
      updateTripStatus('COMPLETED');
      // toast.success('Delivery Success!');
    } catch (error) {
      console.error('Completion Error:', error);
      toast.error(error?.response?.data?.message || 'Verification failed');
      throw error;
    }
  };

  const rejectOrder = async (order, body = {}) => {
    const orderId = canonicalOrderId(order);
    if (!orderId) {
      toast.error('Invalid order data');
      return;
    }

    try {
      const response = await deliveryAPI.rejectOrder(orderId, body);
      if (response?.data?.success) {
        toast.info('Order passed/rejected successfully.');
      } else {
        toast.error(response?.data?.message || 'Failed to reject order');
        throw new Error('Reject failed');
      }
    } catch (error) {
      console.error('Reject Order Error:', error);
      toast.error('Network error. Please try again.');
      throw error;
    }
  };

  const resetTrip = () => {
    clearActiveOrder();
  };

  return {
    acceptOrder,
    rejectOrder,
    reachPickup,
    pickUpOrder,
    reachDrop,
    completeDelivery,
    resetTrip,
  };
};
