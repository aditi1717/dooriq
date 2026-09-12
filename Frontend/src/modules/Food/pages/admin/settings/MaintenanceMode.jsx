import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { adminAPI } from '@/services/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@food/components/ui/card';
import { Button } from '@food/components/ui/button';
import { Switch } from '@food/components/ui/switch';
import { Loader2, Save, AlertTriangle, Clock, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

/**
 * A <input type="datetime-local"> needs "YYYY-MM-DDTHH:mm" in LOCAL time, while
 * the API speaks ISO/UTC. Converting with toISOString() here would shift the
 * value by the timezone offset every time the form loaded — an admin in IST
 * would see a window 5.5 hours off what they saved.
 */
const toLocalInputValue = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Local wall-clock string back to an ISO instant. '' means "no bound". */
const fromLocalInputValue = (value) => {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const formatWhen = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
    });
};

const inputClass =
    'bg-white border border-slate-300 text-slate-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5 outline-none';

export default function MaintenanceMode() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // `active` is what the server computes right now; `isEnabled` is the
    // switch. They differ while a window is pending or already spent, and the
    // banner below exists to explain that difference.
    const [serverState, setServerState] = useState(null);
    const [form, setForm] = useState({
        isEnabled: false,
        message: '',
        startsAt: '',
        endsAt: '',
    });

    const applyState = useCallback((state) => {
        setServerState(state);
        setForm({
            isEnabled: Boolean(state?.isEnabled),
            message: state?.message || '',
            startsAt: toLocalInputValue(state?.startsAt),
            endsAt: toLocalInputValue(state?.endsAt),
        });
    }, []);

    const load = useCallback(async () => {
        try {
            setLoading(true);
            const res = await adminAPI.getMaintenanceSettings();
            applyState(res?.data?.data ?? null);
        } catch (error) {
            toast.error(error?.response?.data?.message || 'Failed to load maintenance settings');
        } finally {
            setLoading(false);
        }
    }, [applyState]);

    useEffect(() => {
        load();
    }, [load]);

    const save = async () => {
        if (form.startsAt && form.endsAt && new Date(form.endsAt) <= new Date(form.startsAt)) {
            toast.error('The window must end after it starts');
            return;
        }
        try {
            setSaving(true);
            const res = await adminAPI.updateMaintenanceSettings({
                isEnabled: form.isEnabled,
                message: form.message,
                startsAt: fromLocalInputValue(form.startsAt),
                endsAt: fromLocalInputValue(form.endsAt),
            });
            const state = res?.data?.data ?? null;
            applyState(state);
            toast.success(
                state?.active ? 'Maintenance mode is now ACTIVE' : 'Maintenance settings saved',
            );
        } catch (error) {
            toast.error(error?.response?.data?.message || 'Failed to save maintenance settings');
        } finally {
            setSaving(false);
        }
    };

    /** What the current form would mean, described in words. */
    const explanation = useMemo(() => {
        if (!form.isEnabled) return { tone: 'ok', text: 'The site is live. Maintenance mode is off.' };

        const now = new Date();
        const startsAt = form.startsAt ? new Date(form.startsAt) : null;
        const endsAt = form.endsAt ? new Date(form.endsAt) : null;

        if (startsAt && startsAt > now) {
            return {
                tone: 'scheduled',
                text: endsAt
                    ? `Scheduled: the site will go down at ${formatWhen(startsAt)} and come back automatically at ${formatWhen(endsAt)}.`
                    : `Scheduled: the site will go down at ${formatWhen(startsAt)} and stay down until you switch this off.`,
            };
        }
        if (endsAt && endsAt <= now) {
            return {
                tone: 'scheduled',
                text: 'The window you set has already passed, so the site is live. Clear the end time or set a new window.',
            };
        }
        return {
            tone: 'down',
            text: endsAt
                ? `The site is DOWN for everyone except admins, and will come back automatically at ${formatWhen(endsAt)}.`
                : 'The site is DOWN for everyone except admins, and will stay down until you switch this off.',
        };
    }, [form.isEnabled, form.startsAt, form.endsAt]);

    const toneStyles = {
        ok: 'border-emerald-200 bg-emerald-50 text-emerald-900',
        scheduled: 'border-amber-200 bg-amber-50 text-amber-900',
        down: 'border-red-200 bg-red-50 text-red-900',
    };
    const ToneIcon = { ok: CheckCircle2, scheduled: Clock, down: AlertTriangle }[explanation.tone];

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center p-6">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div className="h-full overflow-y-auto bg-slate-50 p-4 lg:p-6">
            <div className="max-w-3xl mx-auto space-y-6 pb-10">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">Maintenance Mode</h1>
                    <p className="text-sm text-slate-600 mt-1">
                        Take the customer, restaurant and delivery apps offline with a message, either
                        immediately or on a schedule.
                    </p>
                </div>

                <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${toneStyles[explanation.tone]}`}>
                    <ToneIcon className="h-5 w-5 mt-0.5 shrink-0" />
                    <div className="text-sm">
                        <p className="font-medium">{explanation.text}</p>
                        {serverState && serverState.active !== form.isEnabled && (
                            <p className="mt-1 opacity-80">
                                Saved state: currently {serverState.active ? 'down' : 'live'}.
                            </p>
                        )}
                    </div>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>Switch</CardTitle>
                        <CardDescription>
                            Admins are never locked out — the admin panel and login keep working while
                            maintenance is on, so you can always switch it back off.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 p-4">
                            <div>
                                <p className="font-medium text-slate-900">Enable maintenance mode</p>
                                <p className="text-sm text-slate-600">
                                    With no window set, the site goes down as soon as you save.
                                </p>
                            </div>
                            <Switch
                                checked={form.isEnabled}
                                onCheckedChange={(checked) =>
                                    setForm((prev) => ({ ...prev, isEnabled: Boolean(checked) }))
                                }
                            />
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Window (optional)</CardTitle>
                        <CardDescription>
                            Times are in your own timezone. Leave both blank to control the outage purely
                            with the switch above.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                                <label htmlFor="starts-at" className="text-sm font-medium text-slate-700">
                                    Starts at
                                </label>
                                <input
                                    id="starts-at"
                                    type="datetime-local"
                                    value={form.startsAt}
                                    onChange={(e) => setForm((p) => ({ ...p, startsAt: e.target.value }))}
                                    className={inputClass}
                                />
                                <p className="text-xs text-slate-500">Blank means “as soon as it is enabled”.</p>
                            </div>
                            <div className="space-y-1.5">
                                <label htmlFor="ends-at" className="text-sm font-medium text-slate-700">
                                    Ends at
                                </label>
                                <input
                                    id="ends-at"
                                    type="datetime-local"
                                    value={form.endsAt}
                                    onChange={(e) => setForm((p) => ({ ...p, endsAt: e.target.value }))}
                                    className={inputClass}
                                />
                                <p className="text-xs text-slate-500">
                                    Blank means “until I switch it off”. With a time set, the site comes back on
                                    its own.
                                </p>
                            </div>
                        </div>
                        {(form.startsAt || form.endsAt) && (
                            <button
                                type="button"
                                onClick={() => setForm((p) => ({ ...p, startsAt: '', endsAt: '' }))}
                                className="text-sm text-blue-600 hover:underline"
                            >
                                Clear the window
                            </button>
                        )}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Message</CardTitle>
                        <CardDescription>
                            Shown on the maintenance screen in all three apps. Leave blank for generic copy.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <textarea
                            id="maintenance-message"
                            value={form.message}
                            onChange={(e) => setForm((p) => ({ ...p, message: e.target.value.slice(0, 500) }))}
                            rows={3}
                            maxLength={500}
                            placeholder="We are upgrading our systems and will be back by 3 PM. Sorry for the inconvenience."
                            className={`${inputClass} resize-y`}
                        />
                        <p className="mt-1 text-xs text-slate-500">{form.message.length}/500</p>
                    </CardContent>
                </Card>

                <div className="flex justify-end gap-3">
                    <Button variant="outline" onClick={load} disabled={saving}>
                        Discard changes
                    </Button>
                    <Button onClick={save} disabled={saving}>
                        {saving ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…
                            </>
                        ) : (
                            <>
                                <Save className="mr-2 h-4 w-4" /> Save
                            </>
                        )}
                    </Button>
                </div>
            </div>
        </div>
    );
}
