import React, { useCallback, useEffect, useState } from "react";
import { adminAPI } from "@food/api";
import { Loader2, Save, KeyRound, CheckCircle2, XCircle, Info } from "lucide-react";
import { toast } from "sonner";

/**
 * Third-party credentials that can be rotated without a redeploy.
 *
 * The server never sends the key back — only whether one is set, where it came
 * from and its last four characters. So this form starts empty: an empty input
 * means "leave it alone", not "clear it". Clearing is a separate, explicit
 * action.
 *
 * The Test button exists because the previous failure was silent. Billing was
 * disabled on the Google project and every geocode returned REQUEST_DENIED for
 * weeks, visible only in a server log nobody was reading. Google's own
 * error_message is surfaced verbatim here, since it names the actual problem.
 */

const SOURCE_LABEL = {
  database: "Set here, in the admin panel",
  environment: "Falling back to GOOGLE_MAPS_API_KEY on the server",
  unset: "Not configured anywhere",
};

export default function IntegrationSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState(null);
  const [apiKey, setApiKey] = useState("");
  const [browserKey, setBrowserKey] = useState("");
  const [savingBrowser, setSavingBrowser] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminAPI.getGoogleMapsIntegration();
      setStatus(res?.data?.data ?? res?.data ?? null);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load integration settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await adminAPI.testGoogleMapsIntegration(apiKey.trim() || undefined);
      const result = res?.data?.data ?? res?.data ?? null;
      setTestResult(result);
      if (result?.ok) toast.success("Google Maps key is working.");
      else toast.error(result?.message || "Google rejected the key.");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Could not reach Google.");
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    const value = apiKey.trim();
    if (!value) {
      toast.error("Enter a key to save, or use Clear to fall back to the server value.");
      return;
    }
    setSaving(true);
    try {
      const res = await adminAPI.updateGoogleMapsIntegration(value);
      setStatus(res?.data?.data ?? res?.data ?? null);
      setApiKey("");
      setTestResult(null);
      toast.success("Google Maps API key saved.");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to save the key.");
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    if (!window.confirm("Clear the stored key? The server will fall back to GOOGLE_MAPS_API_KEY.")) return;
    setSaving(true);
    try {
      const res = await adminAPI.updateGoogleMapsIntegration("");
      setStatus(res?.data?.data ?? res?.data ?? null);
      setApiKey("");
      setTestResult(null);
      toast.success("Cleared. Using the server environment value.");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to clear the key.");
    } finally {
      setSaving(false);
    }
  };

  const saveBrowserKey = async (value) => {
    setSavingBrowser(true);
    try {
      const res = await adminAPI.updateGoogleMapsIntegration(value, "browserKey");
      setStatus(res?.data?.data ?? res?.data ?? null);
      setBrowserKey("");
      toast.success(value ? "Browser key saved." : "Browser key cleared.");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to save the browser key.");
    } finally {
      setSavingBrowser(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-gray-500">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="ml-2 text-sm">Loading integration settings…</span>
      </div>
    );
  }

  const configured = Boolean(status?.configured);

  return (
    <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-gray-900">
          <KeyRound className="h-5 w-5 text-gray-500" />
          Integrations
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          Credentials the platform uses for third-party services. Changes take effect
          within a minute, without a redeploy.
        </p>
      </header>

      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Google Maps</h2>
            <p className="mt-0.5 text-sm text-gray-600">
              Used for reverse geocoding customer addresses and calculating delivery routes.
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
              configured ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
            }`}
          >
            {configured ? "Configured" : "Not configured"}
          </span>
        </div>

        <dl className="mb-5 grid gap-3 rounded-md bg-gray-50 p-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Current key</dt>
            <dd className="mt-0.5 font-mono text-gray-900">{status?.maskedKey || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Source</dt>
            <dd className="mt-0.5 text-gray-900">{SOURCE_LABEL[status?.source] || "Unknown"}</dd>
          </div>
          {status?.updatedAt ? (
            <div className="sm:col-span-2">
              <dt className="text-xs uppercase tracking-wide text-gray-500">Last changed</dt>
              <dd className="mt-0.5 text-gray-900">
                {new Date(status.updatedAt).toLocaleString()}
              </dd>
            </div>
          ) : null}
        </dl>

        <label htmlFor="gmaps-key" className="block text-sm font-medium text-gray-900">
          New API key
        </label>
        <input
          id="gmaps-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={apiKey}
          onChange={(e) => {
            setApiKey(e.target.value);
            setTestResult(null);
          }}
          placeholder="Paste a server key, then Test before saving"
          className="mt-1.5 w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
        />
        <p className="mt-1.5 flex items-start gap-1.5 text-xs text-gray-500">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Use a key restricted by <strong>IP address</strong>, not by HTTP referrer —
            referrer-restricted keys are rejected on server-to-server calls. Enable
            Geocoding API and Directions API on it, and make sure billing is active on
            the Google Cloud project.
          </span>
        </p>

        {testResult ? (
          <div
            className={`mt-4 flex items-start gap-2 rounded-md border p-3 text-sm ${
              testResult.ok
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-red-200 bg-red-50 text-red-900"
            }`}
          >
            {testResult.ok ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <div className="min-w-0">
              <p className="font-medium">
                {testResult.ok ? "Key works" : `Rejected — ${testResult.status}`}
              </p>
              <p className="mt-0.5 break-words">{testResult.message}</p>
              {testResult.sampleAddress ? (
                <p className="mt-1 text-xs opacity-80">
                  Resolved test coordinate to: {testResult.sampleAddress}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || saving}
            className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-3.5 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50 disabled:opacity-50"
          >
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {apiKey.trim() ? "Test this key" : "Test current key"}
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving || testing || !apiKey.trim()}
            className="inline-flex items-center gap-2 rounded-md bg-gray-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save key
          </button>

          {status?.source === "database" ? (
            <button
              type="button"
              onClick={handleClear}
              disabled={saving || testing}
              className="ml-auto inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Clear stored key
            </button>
          ) : null}
        </div>
      </section>

      <section className="mt-5 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Google Maps — browser key</h2>
            <p className="mt-0.5 text-sm text-gray-600">
              Used by the maps you see in this panel, and by the customer and restaurant
              web apps. This must be a <strong>different</strong> key from the one above.
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
              status?.browserConfigured ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
            }`}
          >
            {status?.browserConfigured ? "Configured" : "Using build-time value"}
          </span>
        </div>

        <dl className="mb-5 grid gap-3 rounded-md bg-gray-50 p-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Current key</dt>
            <dd className="mt-0.5 font-mono text-gray-900">{status?.browserMaskedKey || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Source</dt>
            <dd className="mt-0.5 text-gray-900">
              {status?.browserSource === "database"
                ? "Set here, in the admin panel"
                : "Falling back to VITE_GOOGLE_MAPS_API_KEY from the build"}
            </dd>
          </div>
        </dl>

        <label htmlFor="gmaps-browser-key" className="block text-sm font-medium text-gray-900">
          New browser key
        </label>
        <input
          id="gmaps-browser-key"
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={browserKey}
          onChange={(e) => setBrowserKey(e.target.value)}
          placeholder="Referrer-restricted key for dooriq.in"
          className="mt-1.5 w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
        />
        <p className="mt-1.5 flex items-start gap-1.5 text-xs text-gray-500">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Restrict this one by <strong>HTTP referrer</strong> (<code>dooriq.in/*</code>),
            and enable Maps JavaScript API and Places API on it. It is delivered to
            browsers and is visible in page source — that is normal, and the referrer
            restriction is what protects it. Do not paste the server key here.
          </span>
        </p>

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => saveBrowserKey(browserKey.trim())}
            disabled={savingBrowser || !browserKey.trim()}
            className="inline-flex items-center gap-2 rounded-md bg-gray-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {savingBrowser ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save browser key
          </button>
          {status?.browserSource === "database" ? (
            <button
              type="button"
              onClick={() => saveBrowserKey("")}
              disabled={savingBrowser}
              className="ml-auto inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Clear browser key
            </button>
          ) : null}
        </div>

        <p className="mt-4 rounded-md bg-blue-50 p-3 text-xs text-blue-900">
          After changing this, users need one page reload before the new key is used —
          the key is fetched once at app start.
        </p>
      </section>
    </div>
  );
}
