import mongoose from 'mongoose';
import { FoodZone } from '../../admin/models/zone.model.js';
import { FoodDeliveryPartner } from '../models/deliveryPartner.model.js';
import { ValidationError } from '../../../../core/auth/errors.js';

/**
 * Rider zone selection.
 *
 * A rider picks a zone when they go online and is then offered orders whose
 * restaurant sits in that zone. Zones are admin-drawn polygons; the same shape
 * the customer-facing serviceability check uses.
 */

/**
 * Ray casting against a zone polygon.
 *
 * Duplicated from restaurant.service.js rather than imported: that copy is
 * module-private there, and the restaurant service pulls in a large dependency
 * tree that the delivery app has no reason to load. Kept deliberately identical
 * so a point cannot be inside a zone for a customer and outside it for a rider.
 */
const isPointInZonePolygon = (lat, lng, polygon = []) => {
    if (!Array.isArray(polygon) || polygon.length < 3) return false;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = Number(polygon[i]?.longitude);
        const yi = Number(polygon[i]?.latitude);
        const xj = Number(polygon[j]?.longitude);
        const yj = Number(polygon[j]?.latitude);
        if (![xi, yi, xj, yj].every(Number.isFinite)) continue;
        const intersect =
            yi > lat !== yj > lat &&
            lng < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi;
        if (intersect) inside = !inside;
    }
    return inside;
};

/** Rough centre of a polygon, for ordering the list by distance. */
const polygonCentre = (coordinates = []) => {
    const pts = coordinates.filter(
        (c) => Number.isFinite(Number(c?.latitude)) && Number.isFinite(Number(c?.longitude)),
    );
    if (!pts.length) return null;
    const lat = pts.reduce((s, c) => s + Number(c.latitude), 0) / pts.length;
    const lng = pts.reduce((s, c) => s + Number(c.longitude), 0) / pts.length;
    return { lat, lng };
};

/** Great-circle distance in km. */
const distanceKm = (a, b) => {
    if (!a || !b) return null;
    const R = 6371;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const s =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
};

/**
 * Zones a rider may choose from.
 *
 * When the rider's position is supplied, the zone containing them is flagged
 * and listed first, then the rest by distance — so the popup can preselect the
 * obvious answer instead of making them hunt through a list.
 *
 * @param {{latitude?: number, longitude?: number}} [position]
 */
export const listSelectableZones = async (position = {}) => {
    const zones = await FoodZone.find({ isActive: true })
        .select('zoneName name coordinates country unit')
        .lean();

    const lat = Number(position?.latitude);
    const lng = Number(position?.longitude);
    const hasPosition = Number.isFinite(lat) && Number.isFinite(lng);
    const me = hasPosition ? { lat, lng } : null;

    const mapped = zones.map((z) => {
        const centre = polygonCentre(z.coordinates);
        return {
            id: String(z._id),
            name: z.zoneName || z.name || 'Unnamed zone',
            containsMe: hasPosition ? isPointInZonePolygon(lat, lng, z.coordinates) : false,
            distanceKm: me && centre ? Number(distanceKm(me, centre).toFixed(2)) : null,
        };
    });

    mapped.sort((a, b) => {
        if (a.containsMe !== b.containsMe) return a.containsMe ? -1 : 1;
        if (a.distanceKm == null || b.distanceKm == null) return a.name.localeCompare(b.name);
        return a.distanceKm - b.distanceKm;
    });

    return mapped;
};

/**
 * Validate a zone id the rider picked.
 * @returns {Promise<mongoose.Types.ObjectId>} the id, once known good
 */
export const assertSelectableZone = async (zoneId) => {
    const raw = String(zoneId || '').trim();
    if (!raw || !mongoose.Types.ObjectId.isValid(raw)) {
        throw new ValidationError('Please select a valid zone');
    }
    const zone = await FoodZone.findOne({ _id: raw, isActive: true }).select('_id').lean();
    if (!zone) {
        throw new ValidationError('That zone is no longer available. Please pick another.');
    }
    return zone._id;
};

/** The rider's current selection, for restoring app state. */
export const getActiveZoneForPartner = async (deliveryPartnerId) => {
    const partner = await FoodDeliveryPartner.findById(deliveryPartnerId)
        .select('activeZoneId availabilityStatus')
        .lean();

    if (!partner) throw new ValidationError('Delivery partner not found');
    if (!partner.activeZoneId) {
        return { availabilityStatus: partner.availabilityStatus || 'offline', zone: null };
    }

    const zone = await FoodZone.findById(partner.activeZoneId).select('zoneName name isActive').lean();
    return {
        availabilityStatus: partner.availabilityStatus || 'offline',
        zone: zone
            ? {
                id: String(zone._id),
                name: zone.zoneName || zone.name || 'Unnamed zone',
                // An admin can deactivate a zone while a rider is working in it.
                // The app should prompt for a new choice rather than silently
                // leaving them attached to something dispatch will not match.
                isActive: zone.isActive !== false,
            }
            : null,
    };
};
