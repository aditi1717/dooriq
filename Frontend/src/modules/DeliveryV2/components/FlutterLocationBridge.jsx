import { useEffect, useMemo } from 'react';

const BRIDGE_EVENT = 'dooriq:flutter-location';

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeLocationPayload(payload = {}) {
  const source =
    payload && typeof payload === 'object' && payload.location && typeof payload.location === 'object'
      ? payload.location
      : payload;

  const lat = toFiniteNumber(source?.lat ?? source?.latitude ?? source?.coords?.latitude);
  const lng = toFiniteNumber(source?.lng ?? source?.longitude ?? source?.coords?.longitude);

  if (lat === null || lng === null) {
    return null;
  }

  return {
    lat,
    lng,
    heading: toFiniteNumber(source?.heading ?? source?.bearing ?? source?.coords?.heading),
    speed: toFiniteNumber(source?.speed ?? source?.coords?.speed),
    accuracy: toFiniteNumber(source?.accuracy ?? source?.coords?.accuracy),
    timestamp: toFiniteNumber(source?.timestamp ?? source?.time) || Date.now(),
    isMocked: Boolean(source?.isMocked ?? source?.mocked ?? false),
    raw: payload,
  };
}

function postTrackingStateToFlutter(state) {
  const serialized = JSON.stringify(state);

  try {
    window.flutter_inappwebview?.callHandler?.('deliveryTrackingState', state)?.catch?.(() => {});
  } catch (_) {}

  try {
    window.DeliveryTrackingBridge?.postMessage?.(serialized);
  } catch (_) {}

  try {
    window.ReactNativeWebView?.postMessage?.(serialized);
  } catch (_) {}
}

export default function FlutterLocationBridge({
  enabled = false,
  orderId = '',
  deliveryPartnerId = '',
  onLocation,
}) {
  const trackingState = useMemo(
    () => ({
      type: 'delivery_tracking_state',
      enabled: Boolean(enabled),
      orderId: orderId ? String(orderId) : '',
      deliveryPartnerId: deliveryPartnerId ? String(deliveryPartnerId) : '',
      updatedAt: Date.now(),
    }),
    [deliveryPartnerId, enabled, orderId],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const bridgeApi = {
      emitLocation(payload = {}) {
        const normalized = normalizeLocationPayload(payload);
        if (!normalized || typeof onLocation !== 'function') return false;
        onLocation(normalized, { source: 'flutter', force: true, fromBridge: true });
        return true;
      },
      getTrackingState() {
        return {
          ...trackingState,
          updatedAt: Date.now(),
        };
      },
      eventName: BRIDGE_EVENT,
    };

    window.DooriqFlutterBridge = window.DooriqFlutterBridge || {};
    window.DooriqFlutterBridge.delivery = bridgeApi;

    const handleWindowEvent = (event) => {
      const payload = event?.detail;
      const normalized = normalizeLocationPayload(payload);
      if (!normalized || typeof onLocation !== 'function') return;
      onLocation(normalized, { source: 'flutter-event', force: true, fromBridge: true });
    };

    window.addEventListener(BRIDGE_EVENT, handleWindowEvent);

    return () => {
      window.removeEventListener(BRIDGE_EVENT, handleWindowEvent);
      if (window.DooriqFlutterBridge?.delivery === bridgeApi) {
        delete window.DooriqFlutterBridge.delivery;
      }
    };
  }, [onLocation, trackingState]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    postTrackingStateToFlutter(trackingState);
  }, [trackingState]);

  return null;
}
