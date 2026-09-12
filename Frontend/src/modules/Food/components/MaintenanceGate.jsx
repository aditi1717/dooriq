import { useCallback, useEffect, useState } from 'react';
import apiClient from '@food/api/axios';

/**
 * Full-screen maintenance notice.
 *
 * Two independent triggers, because either alone leaves a gap:
 *
 *   - A check on mount, so someone opening the site during an outage sees the
 *     notice immediately rather than a half-rendered page whose data calls are
 *     all failing.
 *   - The `apiMaintenance` event from the axios interceptor, so a session that
 *     is already open flips over the moment maintenance starts instead of the
 *     user watching things silently break.
 *
 * Admins are exempt server-side, so this never appears for them — the admin
 * panel keeps working, which is what makes the switch safe to use.
 */

const STATUS_ENDPOINT = '/food/maintenance';

/** How often to re-check while showing the notice, so it clears by itself. */
const RECHECK_MS = 30_000;

/**
 * The status endpoint reports whether the site is down globally, not whether
 * *this* caller is blocked — and admins are exempt server-side. So the gate has
 * to stand aside on admin routes, or an admin trying to end the outage would be
 * shown the very notice they are trying to remove.
 */
const isAdminSurface = () =>
    typeof window !== 'undefined' && window.location.pathname.startsWith('/admin');

export default function MaintenanceGate({ children }) {
    const [state, setState] = useState(null); // null = not in maintenance

    const check = useCallback(async () => {
        if (isAdminSurface()) {
            setState(null);
            return;
        }
        try {
            const res = await apiClient.get(STATUS_ENDPOINT, { contextModule: 'user' });
            const data = res?.data?.data;
            setState(data?.active ? data : null);
        } catch {
            // A failed status check is not evidence of an outage — the network
            // could simply be down. Showing a maintenance notice then would be
            // a lie, so leave whatever state we already had.
        }
    }, []);

    useEffect(() => {
        check();

        const onMaintenance = (event) => {
            if (isAdminSurface()) return;
            const detail = event?.detail || {};
            setState({
                message: detail.message || '',
                endsAt: detail.endsAt || null,
            });
        };
        window.addEventListener('apiMaintenance', onMaintenance);
        return () => window.removeEventListener('apiMaintenance', onMaintenance);
    }, [check]);

    // Only poll while the notice is up. Polling when the site is healthy would
    // add a request every 30s for every open tab, for nothing.
    useEffect(() => {
        if (!state) return undefined;
        const id = setInterval(check, RECHECK_MS);
        return () => clearInterval(id);
    }, [state, check]);

    if (!state || isAdminSurface()) return children;

    const endsAt = state.endsAt ? new Date(state.endsAt) : null;
    const endsAtLabel =
        endsAt && !Number.isNaN(endsAt.getTime())
            ? endsAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
            : null;

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6 py-12">
            <div className="w-full max-w-md text-center">
                <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100">
                    <svg
                        className="h-8 w-8 text-amber-600"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437 1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008Z"
                        />
                    </svg>
                </div>

                <h1 className="text-2xl font-bold text-slate-900">We will be right back</h1>

                <p className="mt-3 text-slate-600 leading-relaxed">
                    {state.message ||
                        'We are carrying out scheduled maintenance and will be back shortly. Thanks for your patience.'}
                </p>

                {endsAtLabel && (
                    <p className="mt-4 text-sm text-slate-500">
                        Expected back by <span className="font-medium text-slate-700">{endsAtLabel}</span>
                    </p>
                )}

                <button
                    type="button"
                    onClick={check}
                    className="mt-8 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800"
                >
                    Try again
                </button>

                <p className="mt-6 text-xs text-slate-400">
                    This page checks automatically every 30 seconds.
                </p>
            </div>
        </div>
    );
}
