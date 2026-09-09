/**
 * Safe construction of MongoDB regex filters from user-supplied search terms.
 *
 * Two separate hazards, both of which have to be handled every single time a
 * search box reaches a query:
 *
 * 1. Catastrophic backtracking. A term like `(a+)+$` sends the regex engine
 *    exponential. Regex evaluation is synchronous and uninterruptible, so the
 *    worker's event loop stops dead until it finishes — no other request on
 *    that process is served. On a small cluster one such request removes a
 *    meaningful fraction of total capacity.
 *
 * 2. Unbounded scans. An unanchored regex cannot use an index, so every one of
 *    these is a collection scan. That is survivable on a short term against a
 *    small collection and is not survivable on either as they grow.
 *
 * Escaping alone fixes (1). The length floor and ceiling are what keep (2)
 * from turning a stray keystroke into a full scan.
 *
 * This lived as five private copies across the codebase, which is how seven
 * call sites ended up passing raw input straight to `new RegExp`. One copy.
 */

/** Longest term we will search on. Beyond this the scan cost stops being worth it. */
export const MAX_SEARCH_TERM_LENGTH = 80;

/**
 * Shortest term we will build a filter for.
 *
 * Deliberately 1, not 2. A single character is a poor search and scans most of
 * the collection, but raising this floor would change what existing screens
 * return: a one-character query would stop filtering and quietly show
 * everything, which is worse than a slow correct answer. Callers that want a
 * stricter floor can pass their own check — the customer-facing restaurant
 * search already requires 2.
 */
export const MIN_SEARCH_TERM_LENGTH = 1;

/**
 * Escape every regex metacharacter so the term is matched literally.
 *
 * @param {unknown} value
 * @returns {string}
 */
export const escapeRegex = (value) =>
    String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Normalise a user-supplied search term: trim, cap the length, escape it.
 *
 * @param {unknown} value
 * @param {{ maxLength?: number }} [options]
 * @returns {string} the escaped term, or '' when it is too short to search on
 */
export const normalizeSearchTerm = (value, { maxLength = MAX_SEARCH_TERM_LENGTH } = {}) => {
    const raw = String(value ?? '').trim().slice(0, maxLength);
    if (raw.length < MIN_SEARCH_TERM_LENGTH) return '';
    return escapeRegex(raw);
};

/**
 * Build a case-insensitive `$regex` filter fragment, or null when the term is
 * unusable. Returning null rather than a match-everything regex is deliberate:
 * the caller decides whether "no term" means "no filter" or "no results",
 * and a silent match-all is the wrong default for either.
 *
 * @param {unknown} value
 * @param {{ anchored?: boolean, maxLength?: number }} [options]
 *        anchored: match from the start of the field, which lets a plain
 *        ascending index on that field serve the query instead of scanning.
 * @returns {{ $regex: string, $options: string } | null}
 */
export const buildSearchRegexFilter = (value, { anchored = false, maxLength } = {}) => {
    const term = normalizeSearchTerm(value, { maxLength });
    if (!term) return null;
    return { $regex: anchored ? `^${term}` : term, $options: 'i' };
};

/**
 * The same thing as a RegExp instance, for the places that need one — `$in`
 * arrays take RegExp objects, not `$regex` documents.
 *
 * @param {unknown} value
 * @param {{ anchored?: boolean, maxLength?: number }} [options]
 * @returns {RegExp | null}
 */
export const buildSearchRegex = (value, { anchored = false, maxLength } = {}) => {
    const term = normalizeSearchTerm(value, { maxLength });
    if (!term) return null;
    return new RegExp(anchored ? `^${term}` : term, 'i');
};
