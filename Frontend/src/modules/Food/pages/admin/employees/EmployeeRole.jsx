import { useEffect, useMemo, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { adminAPI } from "@food/api";
import { Shield, ChevronDown, ChevronRight, Save, ArrowLeft, Check, Lock } from "lucide-react";

export default function EmployeeRole() {
  const [searchParams] = useSearchParams();
  const subAdminId = searchParams.get("id");
  const [catalog, setCatalog] = useState({ sections: [], actions: [] });
  const [subAdmin, setSubAdmin] = useState(null);
  const [permissions, setPermissions] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!subAdminId) return;
    setLoading(true);
    try {
      const [catalogRes, subAdminRes] = await Promise.all([
        adminAPI.getSubAdminPermissionCatalog(),
        adminAPI.getSubAdminById(subAdminId),
      ]);
      const sections = catalogRes?.data?.data?.sections || [];
      const actions = catalogRes?.data?.data?.actions || [];
      const sa = subAdminRes?.data?.data?.subAdmin || null;
      setCatalog({ sections, actions });
      setSubAdmin(sa);
      setPermissions(sa?.permissions || {});
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [subAdminId]);

  const canSave = useMemo(() => Boolean(subAdminId && subAdmin), [subAdminId, subAdmin]);

  const isModuleEnabled = (sectionKey) => {
    const selected = Array.isArray(permissions?.[sectionKey]) ? permissions[sectionKey] : [];
    return selected.includes("view");
  };

  const toggleModule = (sectionKey, checked) => {
    setPermissions((prev) => {
      if (checked) {
        // Turn module ON: Grant view permission at minimum
        const current = Array.isArray(prev?.[sectionKey]) ? prev[sectionKey] : [];
        const next = current.includes("view") ? current : ["view", ...current];
        return { ...prev, [sectionKey]: next };
      } else {
        // Turn module OFF: Revoke all actions
        return { ...prev, [sectionKey]: [] };
      }
    });
  };

  const toggleAction = (sectionKey, action) => {
    setPermissions((prev) => {
      const current = Array.isArray(prev?.[sectionKey]) ? prev[sectionKey] : [];
      let next;
      if (current.includes(action)) {
        next = current.filter((it) => it !== action);
        // If we untoggled 'view', turn off everything for this module
        if (action === "view") {
          next = [];
        }
      } else {
        next = [...current, action];
        // If we toggled any action ON, make sure 'view' is also toggled ON
        if (!next.includes("view")) {
          next.push("view");
        }
      }
      return { ...prev, [sectionKey]: next };
    });
  };

  const toggleAllSection = (sectionKey, checked) => {
    setPermissions((prev) => ({
      ...prev,
      [sectionKey]: checked ? [...catalog.actions] : [],
    }));
  };

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await adminAPI.updateSubAdminPermissions(subAdminId, permissions);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const formatSectionName = (key) => {
    return String(key || "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  };

  if (!subAdminId) {
    return <div className="p-6 text-sm text-red-600">Missing sub-admin id in URL. Open from Sub Admin List.</div>;
  }

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen space-y-6">
      {/* Back Link */}
      <div>
        <Link
          to="/admin/food/employees"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-black transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Sub Admin List
        </Link>
      </div>

      {/* Header Info */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-800">
            <Shield className="w-3.5 h-3.5" /> Sub Admin Profile
          </span>
          <h1 className="text-2xl font-extrabold text-slate-900 mt-2">
            {subAdmin ? subAdmin.name || "Unnamed" : "Loading..."}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {subAdmin ? subAdmin.email : ""} {subAdmin?.phone ? `• ${subAdmin.phone}` : ""}
          </p>
        </div>

        <div>
          <button
            disabled={!canSave || saving}
            onClick={save}
            className="w-full md:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-black text-white hover:bg-neutral-900 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-xl font-semibold shadow transition-all"
          >
            <Save className="w-4 h-4" />
            {saving ? "Saving Changes..." : "Save Permissions"}
          </button>
        </div>
      </div>

      {/* Permissions Matrix */}
      {loading ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-10 flex flex-col items-center justify-center space-y-3">
          <div className="w-8 h-8 border-4 border-slate-200 border-t-black rounded-full animate-spin"></div>
          <p className="text-sm font-medium text-slate-500">Loading catalog and permissions...</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900">Sidebar Module Access Settings</h2>
            <p className="text-xs text-slate-500">Enable modules to show them in the sidebar, then customize specific actions.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {catalog.sections.map((section) => {
              const enabled = isModuleEnabled(section.key);
              const selected = Array.isArray(permissions?.[section.key]) ? permissions[section.key] : [];
              const allChecked = catalog.actions.every((a) => selected.includes(a));

              return (
                <div
                  key={section.key}
                  className={`bg-white border rounded-2xl p-5 shadow-sm transition-all duration-300 ${
                    enabled ? "border-emerald-200 ring-1 ring-emerald-500/10" : "border-slate-200 opacity-80"
                  }`}
                >
                  {/* Module Header */}
                  <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors ${
                          enabled ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"
                        }`}
                      >
                        <Shield className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="font-bold text-slate-900">{formatSectionName(section.key)}</h3>
                        <span className="text-[11px] text-slate-400 font-medium">
                          {enabled ? `${selected.length} Actions Enabled` : "Access Disabled"}
                        </span>
                      </div>
                    </div>

                    {/* Toggle Switch */}
                    <label className="relative inline-flex items-center cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(e) => toggleModule(section.key, e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
                    </label>
                  </div>

                  {/* Actions / Fine-grained permissions */}
                  <div className="pt-4 transition-all duration-300">
                    {enabled ? (
                      <div className="space-y-4">
                        {/* Master Section Toggle */}
                        <div className="flex items-center justify-between bg-slate-50 px-3 py-2 rounded-lg">
                          <span className="text-xs font-semibold text-slate-700">Grant All Actions</span>
                          <input
                            type="checkbox"
                            checked={allChecked}
                            onChange={(e) => toggleAllSection(section.key, e.target.checked)}
                            className="rounded border-slate-300 text-black focus:ring-black h-4 w-4"
                          />
                        </div>

                        {/* Granular Action Checkboxes */}
                        <div className="grid grid-cols-2 gap-3">
                          {catalog.actions.map((action) => {
                            const isChecked = selected.includes(action);
                            return (
                              <label
                                key={action}
                                className={`flex items-center justify-between p-2.5 rounded-xl border text-sm font-medium cursor-pointer transition-all ${
                                  isChecked
                                    ? "bg-slate-50 border-slate-300 text-slate-900"
                                    : "bg-white border-slate-100 hover:border-slate-200 text-slate-500"
                                }`}
                              >
                                <span className="capitalize">{action}</span>
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => toggleAction(section.key, action)}
                                  className="rounded border-slate-300 text-black focus:ring-black h-4 w-4"
                                />
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-6 text-center text-slate-400 space-y-1">
                        <Lock className="w-5 h-5 text-slate-300" />
                        <span className="text-xs font-medium">Access to this module is disabled</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Sticky Bottom Actions (only on larger screens for convenience) */}
      <div className="flex justify-end pt-4">
        <button
          disabled={!canSave || saving}
          onClick={save}
          className="px-6 py-3 bg-black hover:bg-neutral-900 text-white disabled:bg-slate-300 disabled:cursor-not-allowed rounded-xl font-bold shadow-md transition-all inline-flex items-center gap-2"
        >
          <Save className="w-5 h-5" />
          {saving ? "Saving Changes..." : "Save Permissions"}
        </button>
      </div>
    </div>
  );
}
