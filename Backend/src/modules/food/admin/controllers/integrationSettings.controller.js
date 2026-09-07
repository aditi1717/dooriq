import { sendResponse } from '../../../../utils/response.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import {
    getGoogleMapsKeyStatus,
    setGoogleMapsApiKey,
    getGoogleMapsApiKey,
    getGoogleMapsBrowserKey,
    maskSecret,
} from '../services/integrationSettings.service.js';

/**
 * GET /api/v1/food/admin/integrations/google-maps
 *
 * Returns status only — whether a key is configured, where it came from, and
 * its last four characters. The key itself is never sent to a client, so a
 * compromised admin session cannot exfiltrate it by reading the settings
 * screen.
 */
export async function getGoogleMapsSettings(req, res, next) {
    try {
        const status = await getGoogleMapsKeyStatus();
        return sendResponse(res, 200, 'Google Maps settings fetched successfully', status);
    } catch (error) {
        next(error);
    }
}

/**
 * PUT /api/v1/food/admin/integrations/google-maps
 * body: { apiKey: string }
 *
 * An empty string clears the stored key and falls back to GOOGLE_MAPS_API_KEY
 * from the environment.
 */
export async function updateGoogleMapsSettings(req, res, next) {
    try {
        // `field` selects which of the two keys is being written: the
        // server-side key (IP-restricted, used for geocoding and directions)
        // or the browser key (referrer-restricted, served to the web apps).
        const field = req.body?.field === 'browserKey' ? 'browserKey' : 'apiKey';
        const raw = req.body?.apiKey;
        if (raw === undefined || raw === null) {
            throw new ValidationError('apiKey is required. Send an empty string to clear it.');
        }

        const apiKey = String(raw).trim();

        // Google keys are ~39 chars beginning "AIza". Checked rather than
        // enforced, because Google has changed key formats before and a hard
        // rule here would be a support ticket the day they change it again.
        if (apiKey && !/^[A-Za-z0-9_\-]{20,100}$/.test(apiKey)) {
            throw new ValidationError('That does not look like a Google Maps API key.');
        }

        const status = await setGoogleMapsApiKey(apiKey, req.user?.userId || null, field);
        return sendResponse(
            res,
            200,
            apiKey ? 'Google Maps API key saved' : 'Google Maps API key cleared; using environment value',
            status,
        );
    } catch (error) {
        next(error);
    }
}

/**
 * POST /api/v1/food/admin/integrations/google-maps/test
 * body: { apiKey?: string }
 *
 * Verifies a key against the Geocoding API before anyone relies on it. Tests
 * the supplied key when given one, otherwise the key currently in effect, so
 * an admin can check a new key before saving it.
 *
 * This exists because the previous failure mode was silent: billing was
 * disabled on the project and every geocode returned REQUEST_DENIED for weeks,
 * visible only in an error log nobody was reading.
 */
export async function testGoogleMapsKey(req, res, next) {
    try {
        const supplied = String(req.body?.apiKey ?? '').trim();
        const apiKey = supplied || (await getGoogleMapsApiKey());

        if (!apiKey) {
            return sendResponse(res, 200, 'No Google Maps API key is configured', {
                ok: false,
                status: 'NOT_CONFIGURED',
                message: 'Set a key first, or set GOOGLE_MAPS_API_KEY in the environment.',
            });
        }

        // A fixed, well-known coordinate: cheap, cacheable, and a correct key
        // always resolves it.
        const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
        url.searchParams.set('latlng', '22.7196,75.8577'); // Indore
        url.searchParams.set('key', apiKey);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);
        let body;
        try {
            const response = await fetch(url, { signal: controller.signal });
            body = await response.json();
        } finally {
            clearTimeout(timeout);
        }

        const status = String(body?.status || 'UNKNOWN');
        const ok = status === 'OK';

        return sendResponse(res, 200, ok ? 'Google Maps key is working' : 'Google Maps key was rejected', {
            ok,
            status,
            // Google's error_message names the actual problem — billing
            // disabled, API not enabled, referer-restricted key used
            // server-side — so pass it through rather than flattening it.
            message: body?.error_message || (ok ? 'Geocoding responded normally.' : 'No further detail from Google.'),
            testedKey: maskSecret(apiKey),
            testedSource: supplied ? 'supplied' : 'configured',
            sampleAddress: ok ? (body?.results?.[0]?.formatted_address || null) : null,
        });
    } catch (error) {
        if (error?.name === 'AbortError') {
            return sendResponse(res, 200, 'Google Maps did not respond in time', {
                ok: false,
                status: 'TIMEOUT',
                message: 'The request to Google timed out after 10 seconds.',
            });
        }
        next(error);
    }
}


/**
 * GET /api/v1/food/public/maps-config
 *
 * The browser key for the web apps. Public on purpose: a Maps key used by a
 * browser is visible in page source no matter how it is delivered, and Google's
 * HTTP-referrer restriction — not secrecy — is what protects it. The
 * server-side key is never returned here.
 */
export async function getPublicMapsConfig(req, res, next) {
    try {
        const browserKey = await getGoogleMapsBrowserKey();
        return sendResponse(res, 200, 'Maps config fetched successfully', { browserKey });
    } catch (error) {
        next(error);
    }
}
