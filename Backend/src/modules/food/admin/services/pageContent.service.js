import { FoodPageContent } from '../models/pageContent.model.js';
import { ValidationError } from '../../../../core/auth/errors.js';

const normalizeKey = (key) => String(key || '').trim().toLowerCase();

const decodeHtmlEntities = (value) => {
    if (value === null || value === undefined) return value;
    let s = String(value);
    if (!s.includes('&')) return s;
    return s
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'");
};

const normalizeLegalForResponse = (legal) => {
    if (!legal || typeof legal !== 'object') return legal;
    const title = legal.title ?? '';
    const content = decodeHtmlEntities(legal.content ?? '');
    const email = legal.email ?? '';
    const mobile = legal.mobile ?? '';
    return { ...legal, title, content, email, mobile };
};

const normalizeAboutForResponse = (about) => {
    if (!about || typeof about !== 'object') return about;
    return {
        ...about,
        appName: decodeHtmlEntities(about.appName ?? ''),
        version: decodeHtmlEntities(about.version ?? ''),
        description: decodeHtmlEntities(about.description ?? ''),
        logo: decodeHtmlEntities(about.logo ?? '')
    };
};

const sortEnabledItems = (items) =>
    (Array.isArray(items) ? items : [])
        .filter((i) => i?.enabled !== false)
        .sort((a, b) => (a?.order ?? 0) - (b?.order ?? 0))
        .map((i) => ({
            icon: i.icon ?? 'Heart',
            title: decodeHtmlEntities(i.title ?? ''),
            description: decodeHtmlEntities(i.description ?? ''),
            content: decodeHtmlEntities(i.content ?? ''),
            color: i.color ?? '',
            bgColor: i.bgColor ?? '',
            order: i.order ?? 0
        }));

const normalizeSupportForResponse = (support) => {
    if (!support || typeof support !== 'object') return support;
    return {
        heroTitle: decodeHtmlEntities(support.heroTitle ?? ''),
        heroSubtitle: decodeHtmlEntities(support.heroSubtitle ?? ''),
        quickHelp: sortEnabledItems(support.quickHelp),
        contact: {
            phone: support.contact?.phone ?? '',
            email: support.contact?.email ?? '',
            chatAvailability: decodeHtmlEntities(support.contact?.chatAvailability ?? '')
        },
        supportInfo: sortEnabledItems(support.supportInfo),
        footerTitle: decodeHtmlEntities(support.footerTitle ?? ''),
        footerSubtitle: decodeHtmlEntities(support.footerSubtitle ?? '')
    };
};

// Admin needs every item (including disabled ones, with `enabled`/`order`
// intact) to actually manage them — the public shape above deliberately
// drops both. Also carries legacy `title`/`content`/`email`/`mobile`
// aliases: the deployed admin panel's Help & Support page predates this
// structured shape and only reads those four flat fields, so without them
// it renders blank instead of the real contact info.
const rawItemsForAdmin = (items) =>
    (Array.isArray(items) ? items : []).map((i, idx) => ({
        icon: i?.icon ?? 'Heart',
        title: decodeHtmlEntities(i?.title ?? ''),
        description: decodeHtmlEntities(i?.description ?? ''),
        content: decodeHtmlEntities(i?.content ?? ''),
        color: i?.color ?? '',
        bgColor: i?.bgColor ?? '',
        order: i?.order ?? idx,
        enabled: i?.enabled !== false
    }));

const normalizeSupportForAdmin = (support) => {
    if (!support || typeof support !== 'object') return support;
    const email = support.contact?.email ?? '';
    const mobile = support.contact?.phone ?? '';
    return {
        heroTitle: decodeHtmlEntities(support.heroTitle ?? ''),
        heroSubtitle: decodeHtmlEntities(support.heroSubtitle ?? ''),
        quickHelp: rawItemsForAdmin(support.quickHelp),
        contact: {
            phone: mobile,
            email,
            chatAvailability: decodeHtmlEntities(support.contact?.chatAvailability ?? '')
        },
        supportInfo: rawItemsForAdmin(support.supportInfo),
        footerTitle: decodeHtmlEntities(support.footerTitle ?? ''),
        footerSubtitle: decodeHtmlEntities(support.footerSubtitle ?? ''),
        // Legacy flat aliases for the old title/content/email/mobile admin editor.
        title: 'Help & Support',
        content: '',
        email,
        mobile
    };
};

export const getPublicPageByKey = async (key, module = 'ALL') => {
    const k = normalizeKey(key);
    const m = String(module || 'ALL').toUpperCase();
    
    // Try to find the module-specific document first
    let doc = await FoodPageContent.findOne({ key: k, module: m }).lean();
    
    // Fallback to 'ALL' if specific module is not found and we're not already looking for 'ALL'
    if (!doc && m !== 'ALL') {
        doc = await FoodPageContent.findOne({ key: k, module: 'ALL' }).lean();
    }
    
    if (!doc) return { key: k, module: m, data: null };
    if (k === 'about') return { key: k, module: m, data: normalizeAboutForResponse(doc.about || null) };
    if (k === 'support') return { key: k, module: m, data: normalizeSupportForResponse(doc.support || null) };
    return { key: k, module: m, data: normalizeLegalForResponse(doc.legal || null) };
};

export const getAdminPageByKey = async (key, module = 'ALL') => {
    const k = normalizeKey(key);
    const m = String(module || 'ALL').toUpperCase();
    if (k !== 'support') return getPublicPageByKey(key, module);

    let doc = await FoodPageContent.findOne({ key: k, module: m }).lean();
    if (!doc && m !== 'ALL') {
        doc = await FoodPageContent.findOne({ key: k, module: 'ALL' }).lean();
    }
    if (!doc) {
        return { key: k, module: m, data: { title: 'Help & Support', content: '', email: '', mobile: '' } };
    }
    return { key: k, module: m, data: normalizeSupportForAdmin(doc.support || null) };
};

export const upsertLegalPage = async (key, payload, updatedBy, module = 'ALL') => {
    const k = normalizeKey(key);
    const m = String(module || 'ALL').toUpperCase();
    if (!['terms', 'privacy', 'refund', 'shipping', 'cancellation'].includes(k)) {
        throw new ValidationError('Invalid page key');
    }
    const title = String(payload?.title || '').trim();
    const content = decodeHtmlEntities(String(payload?.content || '')).trim();
    const email = String(payload?.email || '').trim();
    const mobile = String(payload?.mobile || '').trim();

    const doc = await FoodPageContent.findOneAndUpdate(
        { key: k, module: m },
        {
            $set: {
                key: k,
                module: m,
                legal: { title, content, email, mobile },
                about: undefined,
                updatedBy: updatedBy || null,
                updatedByRole: 'ADMIN'
            }
        },
        { upsert: true, new: true }
    ).lean();

    return { key: k, module: m, data: normalizeLegalForResponse(doc?.legal || null) };
};

export const upsertAboutPage = async (payload, updatedBy, module = 'ALL') => {
    const m = String(module || 'ALL').toUpperCase();
    const appName = decodeHtmlEntities(String(payload?.appName || '')).trim() || 'Dooriq';
    const version = decodeHtmlEntities(String(payload?.version || '')).trim() || '1.0.0';
    const description = decodeHtmlEntities(String(payload?.description || '')).trim();
    const logo = decodeHtmlEntities(String(payload?.logo || '')).trim();
    const features = Array.isArray(payload?.features) ? payload.features : [];
    const stats = Array.isArray(payload?.stats) ? payload.stats : [];

    const normalizedFeatures = features.map((f, idx) => ({
        icon: String(f?.icon || 'Heart'),
        title: String(f?.title || ''),
        description: String(f?.description || ''),
        color: String(f?.color || ''),
        bgColor: String(f?.bgColor || ''),
        order: Number.isFinite(Number(f?.order)) ? Number(f.order) : idx
    }));

    const doc = await FoodPageContent.findOneAndUpdate(
        { key: 'about', module: m },
        {
            $set: {
                key: 'about',
                module: m,
                about: { appName, version, description, logo, features: normalizedFeatures, stats },
                legal: undefined,
                updatedBy: updatedBy || null,
                updatedByRole: 'ADMIN'
            }
        },
        { upsert: true, new: true }
    ).lean();

    return { key: 'about', module: m, data: normalizeAboutForResponse(doc?.about || null) };
};

const normalizeItemsForWrite = (items) =>
    (Array.isArray(items) ? items : []).map((i, idx) => ({
        icon: String(i?.icon || 'Heart'),
        title: decodeHtmlEntities(String(i?.title || '')),
        description: decodeHtmlEntities(String(i?.description || '')),
        content: decodeHtmlEntities(String(i?.content || '')),
        color: String(i?.color || ''),
        bgColor: String(i?.bgColor || ''),
        order: Number.isFinite(Number(i?.order)) ? Number(i.order) : idx,
        enabled: i?.enabled !== false
    }));

export const upsertSupportPage = async (payload, updatedBy, module = 'ALL') => {
    const m = String(module || 'ALL').toUpperCase();

    // The deployed admin panel's Help & Support editor predates this
    // structured shape and only ever sends {title, content, email, mobile,
    // module} — it has no concept of quickHelp/supportInfo/hero/footer. A
    // full-replace write from that editor would silently wipe all of that
    // out. Detect that legacy shape (none of the structured keys present)
    // and merge the two fields it can legitimately set — contact email and
    // phone — onto the existing document instead of replacing it wholesale.
    const isLegacyFlatPayload =
        payload?.quickHelp === undefined &&
        payload?.supportInfo === undefined &&
        payload?.contact === undefined &&
        payload?.heroTitle === undefined;

    const existing = isLegacyFlatPayload
        ? (await FoodPageContent.findOne({ key: 'support', module: m }).select('support').lean())?.support
        : null;

    const support = isLegacyFlatPayload
        ? {
            heroTitle: existing?.heroTitle ?? '',
            heroSubtitle: existing?.heroSubtitle ?? '',
            quickHelp: existing?.quickHelp ?? [],
            contact: {
                phone: payload?.mobile !== undefined ? String(payload.mobile || '').trim() : (existing?.contact?.phone ?? ''),
                email: payload?.email !== undefined ? String(payload.email || '').trim() : (existing?.contact?.email ?? ''),
                chatAvailability: existing?.contact?.chatAvailability ?? ''
            },
            supportInfo: existing?.supportInfo ?? [],
            footerTitle: existing?.footerTitle ?? '',
            footerSubtitle: existing?.footerSubtitle ?? ''
        }
        : {
            heroTitle: decodeHtmlEntities(String(payload?.heroTitle || '')).trim(),
            heroSubtitle: decodeHtmlEntities(String(payload?.heroSubtitle || '')).trim(),
            quickHelp: normalizeItemsForWrite(payload?.quickHelp),
            contact: {
                phone: String(payload?.contact?.phone || '').trim(),
                email: String(payload?.contact?.email || '').trim(),
                chatAvailability: decodeHtmlEntities(String(payload?.contact?.chatAvailability || '')).trim()
            },
            supportInfo: normalizeItemsForWrite(payload?.supportInfo),
            footerTitle: decodeHtmlEntities(String(payload?.footerTitle || '')).trim(),
            footerSubtitle: decodeHtmlEntities(String(payload?.footerSubtitle || '')).trim()
        };

    const doc = await FoodPageContent.findOneAndUpdate(
        { key: 'support', module: m },
        {
            $set: {
                key: 'support',
                module: m,
                support,
                legal: undefined,
                about: undefined,
                updatedBy: updatedBy || null,
                updatedByRole: 'ADMIN'
            }
        },
        { upsert: true, new: true }
    ).lean();

    return { key: 'support', module: m, data: normalizeSupportForAdmin(doc?.support || null) };
};

