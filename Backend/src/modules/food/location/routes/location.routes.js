import express from 'express';
import { reverseGeocode, isValidCoordinate } from '../services/geocode.service.js';
import { CACHE_PRESETS } from '../../../../middleware/httpCache.js';

const router = express.Router();

/**
 * GET /food/location/reverse-geocode?lat=&lng=
 *
 * Server-side replacement for the browser's direct call to Google's Geocoding
 * web service. Public, because address lookup is needed before sign-in (address
 * selection during checkout), and it exposes no secret — the API key stays on
 * the server.
 *
 * Responds 200 with `resolved: false` rather than an error status when the
 * address cannot be determined, so the client's existing fallback chain runs
 * without treating it as a network failure.
 */
router.get('/reverse-geocode', CACHE_PRESETS.config(), async (req, res, next) => {
    try {
        const { lat, lng } = req.query;

        if (!isValidCoordinate(lat, lng)) {
            return res.status(400).json({
                success: false,
                message: 'Valid lat and lng query parameters are required.',
            });
        }

        const result = await reverseGeocode(lat, lng);

        if (!result) {
            return res.status(200).json({
                success: true,
                resolved: false,
                data: null,
                message: 'Address could not be resolved for this location.',
            });
        }

        return res.status(200).json({
            success: true,
            resolved: true,
            data: result,
        });
    } catch (err) {
        next(err);
    }
});

export default router;
