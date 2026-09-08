import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Search, Shield, Trash2, ToggleLeft, ToggleRight, X } from "lucide-react";
import { adminAPI } from "@food/api";

const SUBADMIN_EMAIL_REGEX = /^(?!.*\.\.)([A-Za-z0-9]+[._%+-]?)*[A-Za-z0-9]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}$/;
const PHONE_REGEX = /^\d{10}$/;
const NAME_REGEX = /^[A-Za-z]+(?:\s+[A-Za-z]+)*$/;

const hasSuspiciousEmailTld = (emailValue) => {
  const email = String(emailValue || "").trim().toLowerCase();
  const domain = email.split("@")[1] || "";
  const tld = domain.split(".").pop() || "";
  if (!tld) return true;
  if (/^com+$/i.test(tld) && tld !== "com") return true;
  if (/(.)\1{2,}/.test(tld)) return true;
  return false;
};

export default function EmployeeList() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "" });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const validateForm = (payload) => {
    const nextErrors = {};
    const name = String(payload?.name || "").trim();
    const email = String(payload?.email || "").trim().toLowerCase();
    const phone = String(payload?.phone || "").trim();
    const password = String(payload?.password || "");

    if (!name) {
      nextErrors.name = "Name is required.";
    } else if (name.length < 2) {
      nextErrors.name = "Name must be at least 2 characters.";
    } else if (!NAME_REGEX.test(name)) {
      nextErrors.name = "Name can contain only letters and spaces.";
    }

    if (!email) {
      nextErrors.email = "Email is required.";
    } else if (!SUBADMIN_EMAIL_REGEX.test(email) || hasSuspiciousEmailTld(email)) {
      nextErrors.email = "Please enter a valid email address (e.g. name@domain.com).";
    }

    if (!phone) {
      nextErrors.phone = "Phone is required.";
    } else if (!PHONE_REGEX.test(phone)) {
      nextErrors.phone = "Phone number must be exactly 10 digits (numbers only).";
    }

    if (!password) {
      nextErrors.password = "Password is required.";
    } else if (password.length < 8) {
      nextErrors.password = "Password must be at least 8 characters.";
    } else if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password) || !/[^\w\s]/.test(password)) {
      nextErrors.password = "Use uppercase, lowercase, number, and special character.";
    }

    return nextErrors;
  };

  const load = async () => {
    setLoading(true);
    try {
      const res = await adminAPI.getSubAdmins({ search });
      setItems(Array.isArray(res?.data?.data?.items) ? res.data.data.items : []);
    } catch (_e) {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter((it) => [it.name, it.email, it.phone].some((v) => String(v || "").toLowerCase().includes(q)));
  }, [items, search]);

  const handleCreate = async (e) => {
    e.preventDefault();
    const normalizedForm = {
      name: String(form.name || "").trim(),
      email: String(form.email || "").trim().toLowerCase(),
      phone: String(form.phone || "").trim(),
      password: String(form.password || ""),
    };
    const validationErrors = validateForm(normalizedForm);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;

    setSaving(true);
    try {
      await adminAPI.createSubAdmin(normalizedForm);
      setForm({ name: "", email: "", phone: "", password: "" });
      setErrors({});
      setIsModalOpen(false);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (item) => {
    await adminAPI.updateSubAdminStatus(item._id, !item.isActive);
    await load();
  };

  const remove = async (item) => {
    if (!window.confirm(`Delete ${item.name || item.email}?`)) return;
    await adminAPI.deleteSubAdmin(item._id);
    await load();
  };

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen space-y-6">
      {/* Header card with "Add Sub Admin" button */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900">Sub Admin Management</h1>
          <p className="text-sm text-slate-500 mt-1">Create, disable, and delete sub admins. Permissions are managed per admin.</p>
        </div>
        <div>
          <button
            onClick={() => setIsModalOpen(true)}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-black text-white hover:bg-neutral-905 rounded-xl font-semibold shadow transition-all"
          >
            <Plus className="w-4.5 h-4.5" /> Add Sub Admin
          </button>
        </div>
      </div>

      {/* Main List Section */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="relative w-full max-w-sm">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="border border-slate-200 rounded-xl pl-10 pr-4 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-black/5"
              placeholder="Search sub admins..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button className="px-4 py-2 border border-slate-200 rounded-xl text-sm font-semibold hover:bg-slate-50 transition" onClick={load}>
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <div className="w-8 h-8 border-4 border-slate-200 border-t-black rounded-full animate-spin"></div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {filtered.map((item) => (
              <div key={item._id} className="border border-slate-100 hover:border-slate-200 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all">
                <div>
                  <p className="font-bold text-slate-900 text-base">{item.name || "Unnamed"}</p>
                  <p className="text-sm text-slate-500 mt-0.5">{item.email} {item.phone ? `• ${item.phone}` : ""}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`/admin/food/employee-role?id=${item._id}`} className="inline-flex items-center justify-center gap-1.5 px-4 py-2 border border-slate-200 hover:bg-slate-50 rounded-xl text-sm font-semibold transition">
                    <Shield className="w-4 h-4 text-slate-500" /> Permissions
                  </Link>
                  <button onClick={() => toggleStatus(item)} className="px-4 py-2 border border-slate-200 hover:bg-slate-50 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-1.5 transition">
                    {item.isActive ? <ToggleRight className="w-5 h-5 text-green-600" /> : <ToggleLeft className="w-5 h-5 text-slate-400" />}
                    {item.isActive ? "Disable" : "Enable"}
                  </button>
                  <button onClick={() => remove(item)} className="px-4 py-2 border border-red-100 hover:bg-red-50 text-red-600 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-1.5 transition">
                    <Trash2 className="w-4 h-4" /> Delete
                  </button>
                </div>
              </div>
            ))}
            {!filtered.length && <div className="text-center py-10 text-sm font-medium text-slate-400">No sub admins found.</div>}
          </div>
        )}
      </div>

      {/* Add Sub Admin Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-lg shadow-2xl overflow-hidden animate-scale-up">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Create New Sub Admin</h2>
              <button
                onClick={() => {
                  setIsModalOpen(false);
                  setForm({ name: "", email: "", phone: "", password: "" });
                  setErrors({});
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleCreate} className="p-6 space-y-4">
              {/* Dummy hidden inputs to intercept browser autofill */}
              <input type="text" name="dummy-username" style={{ display: 'none' }} autoComplete="new-username" />
              <input type="password" name="dummy-password" style={{ display: 'none' }} autoComplete="new-password" />

              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Full Name</label>
                <input
                  className={`border rounded-xl px-3.5 py-2.5 w-full text-sm focus:outline-none focus:ring-2 focus:ring-black/5 ${errors.name ? "border-red-400 bg-red-50/10" : "border-slate-200"}`}
                  placeholder="e.g. John Doe"
                  value={form.name}
                  autoComplete="new-name"
                  onChange={(e) => {
                    const cleaned = e.target.value.replace(/[^A-Za-z\s]/g, "").replace(/\s{2,}/g, " ");
                    setForm((p) => ({ ...p, name: cleaned }));
                    if (errors.name) setErrors((prev) => ({ ...prev, name: "" }));
                  }}
                />
                {errors.name ? <p className="mt-1.5 text-xs text-red-600 font-medium">{errors.name}</p> : null}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Email Address</label>
                <input
                  className={`border rounded-xl px-3.5 py-2.5 w-full text-sm focus:outline-none focus:ring-2 focus:ring-black/5 ${errors.email ? "border-red-400 bg-red-50/10" : "border-slate-200"}`}
                  type="email"
                  placeholder="e.g. john@example.com"
                  value={form.email}
                  autoComplete="new-email"
                  onChange={(e) => {
                    setForm((p) => ({ ...p, email: e.target.value }));
                    if (errors.email) setErrors((prev) => ({ ...prev, email: "" }));
                  }}
                />
                {errors.email ? <p className="mt-1.5 text-xs text-red-600 font-medium">{errors.email}</p> : null}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Phone Number</label>
                <input
                  className={`border rounded-xl px-3.5 py-2.5 w-full text-sm focus:outline-none focus:ring-2 focus:ring-black/5 ${errors.phone ? "border-red-400 bg-red-50/10" : "border-slate-200"}`}
                  type="tel"
                  placeholder="e.g. 9876543210"
                  value={form.phone}
                  autoComplete="new-phone"
                  onChange={(e) => {
                    const onlyDigits = e.target.value.replace(/\D/g, "").slice(0, 10);
                    setForm((p) => ({ ...p, phone: onlyDigits }));
                    if (errors.phone) setErrors((prev) => ({ ...prev, phone: "" }));
                  }}
                />
                {errors.phone ? <p className="mt-1.5 text-xs text-red-600 font-medium">{errors.phone}</p> : null}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Password</label>
                <input
                  className={`border rounded-xl px-3.5 py-2.5 w-full text-sm focus:outline-none focus:ring-2 focus:ring-black/5 ${errors.password ? "border-red-400 bg-red-50/10" : "border-slate-200"}`}
                  placeholder="Minimum 8 characters with upper, lower, digit & special"
                  type="password"
                  value={form.password}
                  autoComplete="new-password"
                  onChange={(e) => {
                    setForm((p) => ({ ...p, password: e.target.value }));
                    if (errors.password) setErrors((prev) => ({ ...prev, password: "" }));
                  }}
                />
                {errors.password ? <p className="mt-1.5 text-xs text-red-600 font-medium">{errors.password}</p> : null}
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100 mt-6">
                <button
                  type="button"
                  onClick={() => {
                    setIsModalOpen(false);
                    setForm({ name: "", email: "", phone: "", password: "" });
                    setErrors({});
                  }}
                  className="px-4 py-2.5 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl text-sm font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2.5 bg-black text-white hover:bg-neutral-900 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-xl text-sm font-semibold transition flex items-center gap-1.5"
                >
                  {saving ? "Creating..." : "Create Sub Admin"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
