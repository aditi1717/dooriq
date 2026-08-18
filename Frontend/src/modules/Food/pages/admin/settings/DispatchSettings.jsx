import React, { useCallback, useEffect, useState } from "react";
import { adminAPI } from "@food/api";
import { Loader2, Plus, Save, Trash2, ArrowDown, RotateCcw, Radio } from "lucide-react";
import { toast } from "sonner";

/**
 * Dispatch policy: how far the platform broadcasts a new order, and how long it
 * waits before widening the search.
 *
 * Every value on this page used to be hardcoded in order-dispatch.service.js.
 * The form reads its own validation bounds from /dispatch-settings/schema so the
 * limits live in exactly one place (the backend) instead of being duplicated
 * here and drifting out of sync.
 */

const FINAL_STAGE_LABELS = {
  repeat_last: "Keep retrying at the widest radius",
  stop: "Stop searching and wait for manual assignment",
  crisis_only: "Stop widening, but alert admins",
};

const emptyStage = () => ({ radiusKm: "", timeoutSeconds: "30" });

export default function DispatchSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [limits, setLimits] = useState(null);
  const [defaults, setDefaults] = useState(null);
  const [behaviors, setBehaviors] = useState(["repeat_last", "stop", "crisis_only"]);
  const [form, setForm] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await adminAPI.getDispatchSettingsSchema();
      const data = res?.data?.data || {};
      const current = data.current || {};
      setLimits(data.limits || null);
      setDefaults(data.defaults || null);
      if (Array.isArray(data.finalStageBehaviors) && data.finalStageBehaviors.length) {
        setBehaviors(data.finalStageBehaviors);
      }
      setForm({
        radiusExpansionEnabled: current.radiusExpansionEnabled !== false,
        stages: (current.stages || []).map((s) => ({
          radiusKm: String(s.radiusKm ?? ""),
          timeoutSeconds: String(s.timeoutSeconds ?? 30),
        })),
        maxRadiusKm: String(current.maxRadiusKm ?? ""),
        maxAttempts: String(current.maxAttempts ?? 0),
        crisisAfterStage: String(current.crisisAfterStage ?? 0),
        finalStageBehavior: current.finalStageBehavior || "repeat_last",
        riderFanoutLimit: String(current.riderFanoutLimit ?? 15),
        offerCountdownSeconds: String(current.offerCountdownSeconds ?? 30),
        timeoutCooldownSeconds: String(current.timeoutCooldownSeconds ?? 120),
        staleGpsMinutes: String(current.staleGpsMinutes ?? 10),
        includeStaleGpsRiders: current.includeStaleGpsRiders === true,
        unboundedFallbackEnabled: current.unboundedFallbackEnabled === true,
      });
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load dispatch settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const setStage = (index, key, value) =>
    setForm((prev) => ({
      ...prev,
      stages: prev.stages.map((s, i) => (i === index ? { ...s, [key]: value } : s)),
    }));

  const addStage = () => setForm((prev) => ({ ...prev, stages: [...prev.stages, emptyStage()] }));

  const removeStage = (index) =>
    setForm((prev) => ({ ...prev, stages: prev.stages.filter((_, i) => i !== index) }));

  const resetToDefaults = () => {
    if (!defaults) return;
    setForm({
      radiusExpansionEnabled: defaults.radiusExpansionEnabled !== false,
      stages: (defaults.stages || []).map((s) => ({
        radiusKm: String(s.radiusKm),
        timeoutSeconds: String(s.timeoutSeconds),
      })),
      maxRadiusKm: String(defaults.maxRadiusKm ?? ""),
      maxAttempts: String(defaults.maxAttempts ?? 0),
      crisisAfterStage: String(defaults.crisisAfterStage ?? 0),
      finalStageBehavior: defaults.finalStageBehavior || "repeat_last",
      riderFanoutLimit: String(defaults.riderFanoutLimit ?? 15),
      offerCountdownSeconds: String(defaults.offerCountdownSeconds ?? 30),
      timeoutCooldownSeconds: String(defaults.timeoutCooldownSeconds ?? 120),
      staleGpsMinutes: String(defaults.staleGpsMinutes ?? 10),
      includeStaleGpsRiders: defaults.includeStaleGpsRiders === true,
      unboundedFallbackEnabled: defaults.unboundedFallbackEnabled === true,
    });
    toast.info("Reset to defaults. Nothing is saved until you press Save.");
  };

  const handleSave = async () => {
    if (!form) return;

    const stages = form.stages
      .map((s) => ({ radiusKm: Number(s.radiusKm), timeoutSeconds: Number(s.timeoutSeconds) }))
      .filter((s) => Number.isFinite(s.radiusKm) && s.radiusKm > 0);

    if (stages.length === 0) {
      toast.error("Add at least one stage with a radius greater than 0.");
      return;
    }

    // Mirror the server rule so the operator sees the problem without a round-trip.
    // The backend still enforces it — this is convenience, not the security boundary.
    for (let i = 1; i < stages.length; i += 1) {
      if (stages[i].radiusKm <= stages[i - 1].radiusKm) {
        toast.error(`Stage ${i + 1} radius must be larger than stage ${i}. Stages expand outward.`);
        return;
      }
    }

    try {
      setSaving(true);
      await adminAPI.updateDispatchSettings({
        radiusExpansionEnabled: form.radiusExpansionEnabled,
        stages,
        maxRadiusKm: Number(form.maxRadiusKm) || stages[stages.length - 1].radiusKm,
        maxAttempts: Number(form.maxAttempts) || 0,
        crisisAfterStage: Number(form.crisisAfterStage) || 0,
        finalStageBehavior: form.finalStageBehavior,
        riderFanoutLimit: Number(form.riderFanoutLimit) || 15,
        offerCountdownSeconds: Number(form.offerCountdownSeconds) || 30,
        timeoutCooldownSeconds: Number(form.timeoutCooldownSeconds) || 0,
        staleGpsMinutes: Number(form.staleGpsMinutes) || 10,
        includeStaleGpsRiders: form.includeStaleGpsRiders,
        unboundedFallbackEnabled: form.unboundedFallbackEnabled,
      });
      toast.success("Saved. New orders use these values immediately.");
      await load();
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to save dispatch settings.");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !form) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  const numberInput =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
  const labelClass = "block text-xs font-semibold text-slate-600 mb-1";

  return (
    <div className="min-h-screen bg-slate-50 p-3 lg:p-5">
      <div className="mx-auto max-w-5xl">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white">
              <Radio className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900">Order Broadcast Settings</h1>
              <p className="text-xs text-slate-500">
                How far each order is broadcast to delivery partners, and how long before the search widens.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={resetToDefaults}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <RotateCcw className="h-4 w-4" />
              Reset to defaults
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? "Saving..." : "Save settings"}
            </button>
          </div>
        </div>

        <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Broadcast radius stages</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Attempt 1 uses stage 1. If nobody accepts within that stage&apos;s wait time, the search widens to
                stage 2, and so on.
              </p>
            </div>
            <label className="flex shrink-0 items-center gap-2 text-xs font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={form.radiusExpansionEnabled}
                onChange={(e) => setField("radiusExpansionEnabled", e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              Expand radius
            </label>
          </div>

          {!form.radiusExpansionEnabled && (
            <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
              Expansion is off, so every attempt uses stage 1 only.
            </p>
          )}

          <div className="space-y-2">
            {form.stages.map((stage, index) => (
              <div
                key={index}
                className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3"
              >
                <span className="w-16 shrink-0 text-xs font-bold text-slate-500">Stage {index + 1}</span>
                <div className="flex-1">
                  <label className={labelClass}>Radius (km)</label>
                  <input
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={stage.radiusKm}
                    onChange={(e) => setStage(index, "radiusKm", e.target.value)}
                    placeholder="e.g. 5"
                    className={numberInput}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeStage(index)}
                  disabled={form.stages.length <= 1}
                  aria-label={`Remove stage ${index + 1}`}
                  className="mt-5 rounded-lg border border-slate-300 bg-white p-2 text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addStage}
            disabled={form.stages.length >= (limits?.maxStages ?? 20)}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm font-semibold text-slate-600 hover:border-blue-400 hover:text-blue-600 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            Add stage
          </button>

          {/* Plain-language preview so the operator can sanity-check before saving. */}
          <div className="mt-4 rounded-xl bg-slate-900 p-4">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
              What will happen
            </p>
            <ol className="space-y-1 text-xs text-slate-200">
              {form.stages.map((s, i) => (
                <li key={i} className="flex items-center gap-2">
                  <ArrowDown className="h-3 w-3 shrink-0 text-blue-400" />
                  <span>
                    Attempt {i + 1}: offer to riders within{" "}
                    <b className="text-white">{s.radiusKm || "?"} km</b>, wait{" "}
                    <b className="text-white">{form.offerCountdownSeconds || "?"}s</b>
                  </span>
                </li>
              ))}
              <li className="flex items-center gap-2 pt-1 text-slate-400">
                <ArrowDown className="h-3 w-3 shrink-0" />
                <span>Then: {FINAL_STAGE_LABELS[form.finalStageBehavior]}</span>
              </li>
            </ol>
          </div>
        </div>

        <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-bold text-slate-900">Limits and escalation</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className={labelClass}>Maximum radius (km)</label>
              <input
                type="number"
                min="0.1"
                step="0.1"
                value={form.maxRadiusKm}
                onChange={(e) => setField("maxRadiusKm", e.target.value)}
                className={numberInput}
              />
              <p className="mt-1 text-[11px] text-slate-500">Hard ceiling. Stages are capped to this.</p>
            </div>
            <div>
              <label className={labelClass}>Maximum attempts</label>
              <input
                type="number"
                min="0"
                step="1"
                value={form.maxAttempts}
                onChange={(e) => setField("maxAttempts", e.target.value)}
                className={numberInput}
              />
              <p className="mt-1 text-[11px] text-slate-500">0 means keep searching indefinitely.</p>
            </div>
            <div>
              <label className={labelClass}>Alert admins after stage</label>
              <input
                type="number"
                min="0"
                step="1"
                value={form.crisisAfterStage}
                onChange={(e) => setField("crisisAfterStage", e.target.value)}
                className={numberInput}
              />
              <p className="mt-1 text-[11px] text-slate-500">0 disables the alert.</p>
            </div>
            <div>
              <label className={labelClass}>When stages run out</label>
              <select
                value={form.finalStageBehavior}
                onChange={(e) => setField("finalStageBehavior", e.target.value)}
                className={numberInput}
              >
                {behaviors.map((b) => (
                  <option key={b} value={b}>
                    {FINAL_STAGE_LABELS[b] || b}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Riders per broadcast</label>
              <input
                type="number"
                min={limits?.minFanout ?? 1}
                max={limits?.maxFanout ?? 200}
                step="1"
                value={form.riderFanoutLimit}
                onChange={(e) => setField("riderFanoutLimit", e.target.value)}
                className={numberInput}
              />
              <p className="mt-1 text-[11px] text-slate-500">Closest riders are offered first.</p>
            </div>
            <div>
              <label className={labelClass}>Rider accept countdown (seconds)</label>
              <input
                type="number"
                min={limits?.minTimeoutSeconds ?? 5}
                step="5"
                value={form.offerCountdownSeconds}
                onChange={(e) => setField("offerCountdownSeconds", e.target.value)}
                className={numberInput}
              />
              <p className="mt-1 text-[11px] text-slate-500">Timer shown in the rider app.</p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-bold text-slate-900">Rider eligibility</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Missed-offer cooldown (seconds)</label>
              <input
                type="number"
                min="0"
                step="10"
                value={form.timeoutCooldownSeconds}
                onChange={(e) => setField("timeoutCooldownSeconds", e.target.value)}
                className={numberInput}
              />
              <p className="mt-1 text-[11px] text-slate-500">
                How long a rider is skipped after letting an offer time out. 0 means skipped permanently for that
                order. An explicit rejection is always permanent.
              </p>
            </div>
            <div>
              <label className={labelClass}>Treat GPS as stale after (minutes)</label>
              <input
                type="number"
                min="1"
                step="1"
                value={form.staleGpsMinutes}
                onChange={(e) => setField("staleGpsMinutes", e.target.value)}
                className={numberInput}
              />
              <p className="mt-1 text-[11px] text-slate-500">
                A rider whose last location is older than this has an unknown position.
              </p>
            </div>
            <label className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <input
                type="checkbox"
                checked={form.includeStaleGpsRiders}
                onChange={(e) => setField("includeStaleGpsRiders", e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300"
              />
              <span className="text-xs text-slate-700">
                <b className="block text-slate-900">Include riders with stale GPS</b>
                Off (recommended) means the radius above is respected exactly. On, riders with an unknown position
                are offered orders regardless of distance.
              </span>
            </label>
            <label className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <input
                type="checkbox"
                checked={form.unboundedFallbackEnabled}
                onChange={(e) => setField("unboundedFallbackEnabled", e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300"
              />
              <span className="text-xs text-slate-700">
                <b className="block text-slate-900">Offer platform-wide if nobody is in range</b>
                Off (recommended). On, an empty stage falls back to every online rider at any distance, which makes
                the radius advisory.
              </span>
            </label>
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-slate-400">
          Changes apply to the next order. No restart or redeploy needed.
        </p>
      </div>
    </div>
  );
}
