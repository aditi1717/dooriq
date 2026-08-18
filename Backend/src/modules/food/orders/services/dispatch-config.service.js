/**
 * Single authoritative source for order-dispatch configuration.
 *
 * Everything the dispatch loop used to hardcode - the radius ladder, the retry
 * delay, the fan-out size, when the crisis alert fires - now lives in one
 * `FoodSettings` document keyed `dispatch` and is read through here.
 *
 * Two entry points, deliberately different in temperament:
 *
 *   validateDispatchConfigInput()  strict. Used on the admin write path, throws
 *                                  ValidationError on anything questionable so
 *                                  the operator gets told what is wrong.
 *
 *   normalizeDispatchConfig()      lenient. Used on every read. NEVER throws and
 *                                  never returns something dispatch cannot use.
 *                                  A corrupt or half-migrated document degrades
 *                                  to the defaults with warnings attached rather
 *                                  than taking live dispatch down.
 *
 * The defaults reproduce the previously hardcoded behaviour (15/25/40/60 km,
 * 30s retries, crisis on attempt 6) on purpose. Deploying this change must not
 * silently move dispatch radii on a live system - the new behaviour starts only
 * when an admin saves a configuration.
 */

import { FoodSettings } from '../models/order.model.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { logger } from '../../../../utils/logger.js';
import { createTtlCache } from '../../../../utils/cache.js';

export const DISPATCH_SETTINGS_KEY = 'dispatch';

/** What to do once the configured stages are used up. */
export const FINAL_STAGE_BEHAVIORS = Object.freeze(['repeat_last', 'stop', 'crisis_only']);

/** Guard rails. Admin input outside these is rejected; stored data is clamped. */
export const CONFIG_LIMITS = Object.freeze({
  minRadiusKm: 0.1,
  maxRadiusKm: 500,
  minTimeoutSeconds: 5,
  maxTimeoutSeconds: 3600,
  minStages: 1,
  maxStages: 20,
  minFanout: 1,
  maxFanout: 200,
  maxAttemptsCeiling: 100,
});

/**
 * Behaviour-preserving fallback. Mirrors what the code did before this module
 * existed, so an un-configured deployment behaves exactly as it does today.
 */
export const DEFAULT_DISPATCH_CONFIG = Object.freeze({
  dispatchMode: 'auto',
  radiusExpansionEnabled: true,
  stages: Object.freeze([
    Object.freeze({ radiusKm: 15, timeoutSeconds: 30 }),
    Object.freeze({ radiusKm: 25, timeoutSeconds: 30 }),
    Object.freeze({ radiusKm: 40, timeoutSeconds: 30 }),
    Object.freeze({ radiusKm: 60, timeoutSeconds: 30 }),
  ]),
  maxRadiusKm: 60,
  /** 0 = keep hunting forever, which is what the old loop did. */
  maxAttempts: 0,
  /** Crisis escalation begins once `attempt` exceeds this. 5 => fires on attempt 6. */
  crisisAfterStage: 5,
  finalStageBehavior: 'repeat_last',
  riderFanoutLimit: 15,
  offerCountdownSeconds: 30,
  /**
   * How long a rider is skipped after letting an offer time out.
   *
   * A timeout is not a refusal — the rider's screen may have been off, or they
   * were mid-tap. Previously it was recorded identically to an explicit rejection
   * and excluded them from that order permanently, which on a thin roster is the
   * difference between assigned and stranded. Set 0 to restore the old
   * permanent-exclusion behaviour. An explicit `rejected` is always permanent.
   */
  timeoutCooldownSeconds: 120,
  staleGpsMinutes: 10,
  /**
   * Riders whose last GPS fix is older than `staleGpsMinutes` have an unknown
   * position, so including them means the radius does not actually bound the
   * broadcast. The old code added them to EVERY broadcast with a sentinel distance
   * of 999 that sat outside the radius check.
   *
   * Now false: the configured radius means what it says. A genuinely-online rider
   * heartbeats every ~10s, so a fix older than `staleGpsMinutes` indicates an app
   * that has stopped reporting rather than a rider who is actually available.
   * Set true to restore the old behaviour.
   */
  includeStaleGpsRiders: false,
  /**
   * When nobody was inside the radius, the old code fell back to "every online
   * rider, any distance" — which silently turned a 5 km policy into a
   * platform-wide broadcast, and did the same when a restaurant had no
   * coordinates on file.
   *
   * Now false: an empty stage is a real signal. The ladder expands on the next
   * attempt, and if it runs out the crisis alert escalates to an admin, which is
   * the honest outcome rather than pretending distance did not matter.
   */
  unboundedFallbackEnabled: false,
});

const configCache = createTtlCache({ ttlMs: 15_000, maxEntries: 4, name: 'dispatch-config' });

const toFiniteNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/**
 * Coerce anything into a config dispatch can run with. Never throws.
 *
 * @param {object|null} raw Stored (or partial) configuration.
 * @returns {{ config: object, warnings: string[], usedDefaults: boolean }}
 */
export function normalizeDispatchConfig(raw) {
  const warnings = [];
  const source = raw && typeof raw === 'object' ? raw : {};

  const maxRadiusRaw = toFiniteNumber(source.maxRadiusKm);
  let maxRadiusKm =
    maxRadiusRaw !== null && maxRadiusRaw > 0
      ? clamp(maxRadiusRaw, CONFIG_LIMITS.minRadiusKm, CONFIG_LIMITS.maxRadiusKm)
      : null;

  // --- stages -------------------------------------------------------------
  const rawStages = Array.isArray(source.stages) ? source.stages : [];
  const seenRadii = new Set();
  let stages = [];

  for (const entry of rawStages) {
    if (!entry || typeof entry !== 'object') {
      warnings.push('Dropped a dispatch stage that was not an object.');
      continue;
    }
    const radiusKm = toFiniteNumber(entry.radiusKm);
    if (radiusKm === null || radiusKm <= 0) {
      warnings.push(`Dropped dispatch stage with invalid radius: ${JSON.stringify(entry.radiusKm)}.`);
      continue;
    }
    const boundedRadius = clamp(radiusKm, CONFIG_LIMITS.minRadiusKm, CONFIG_LIMITS.maxRadiusKm);

    const radiusKey = boundedRadius.toFixed(3);
    if (seenRadii.has(radiusKey)) {
      warnings.push(`Dropped duplicate dispatch stage radius ${boundedRadius} km.`);
      continue;
    }
    seenRadii.add(radiusKey);

    const timeoutRaw = toFiniteNumber(entry.timeoutSeconds);
    const timeoutSeconds =
      timeoutRaw !== null && timeoutRaw > 0
        ? clamp(timeoutRaw, CONFIG_LIMITS.minTimeoutSeconds, CONFIG_LIMITS.maxTimeoutSeconds)
        : DEFAULT_DISPATCH_CONFIG.stages[0].timeoutSeconds;

    if (timeoutRaw !== null && timeoutSeconds !== timeoutRaw) {
      warnings.push(`Clamped stage timeout ${timeoutRaw}s to ${timeoutSeconds}s.`);
    }

    stages.push({ radiusKm: boundedRadius, timeoutSeconds });
  }

  // A radius ladder that does not ascend is almost certainly an input mistake.
  // Sort rather than reject: dispatch must keep running.
  const wasOrdered = stages.every((s, i) => i === 0 || s.radiusKm > stages[i - 1].radiusKm);
  if (!wasOrdered) {
    warnings.push('Dispatch stages were not in ascending radius order; reordered automatically.');
    stages.sort((a, b) => a.radiusKm - b.radiusKm);
  }

  if (stages.length > CONFIG_LIMITS.maxStages) {
    warnings.push(`Trimmed dispatch stages to the maximum of ${CONFIG_LIMITS.maxStages}.`);
    stages = stages.slice(0, CONFIG_LIMITS.maxStages);
  }

  let usedDefaults = false;
  if (stages.length === 0) {
    if (rawStages.length > 0) {
      warnings.push('No usable dispatch stages survived validation; falling back to defaults.');
    }
    stages = DEFAULT_DISPATCH_CONFIG.stages.map((s) => ({ ...s }));
    usedDefaults = true;
  }

  // maxRadiusKm caps the ladder. Derive it when unset so it is always meaningful.
  const widestStage = stages[stages.length - 1].radiusKm;
  if (maxRadiusKm === null) {
    maxRadiusKm = widestStage;
  } else if (widestStage > maxRadiusKm) {
    warnings.push(`Capped dispatch stages at the configured maximum radius of ${maxRadiusKm} km.`);
    stages = stages.map((s) => ({ ...s, radiusKm: Math.min(s.radiusKm, maxRadiusKm) }));
    // Capping can create duplicates at the ceiling; collapse them.
    const collapsed = [];
    for (const stage of stages) {
      const previous = collapsed[collapsed.length - 1];
      if (previous && previous.radiusKm === stage.radiusKm) {
        previous.timeoutSeconds = Math.max(previous.timeoutSeconds, stage.timeoutSeconds);
        continue;
      }
      collapsed.push(stage);
    }
    stages = collapsed;
  }

  // --- scalars ------------------------------------------------------------
  const maxAttemptsRaw = toFiniteNumber(source.maxAttempts);
  const maxAttempts =
    maxAttemptsRaw !== null && maxAttemptsRaw > 0
      ? Math.floor(clamp(maxAttemptsRaw, 1, CONFIG_LIMITS.maxAttemptsCeiling))
      : 0;

  const crisisRaw = toFiniteNumber(source.crisisAfterStage);
  const crisisAfterStage =
    crisisRaw !== null && crisisRaw >= 0
      ? Math.floor(clamp(crisisRaw, 0, CONFIG_LIMITS.maxAttemptsCeiling))
      : DEFAULT_DISPATCH_CONFIG.crisisAfterStage;

  const finalStageBehavior = FINAL_STAGE_BEHAVIORS.includes(source.finalStageBehavior)
    ? source.finalStageBehavior
    : DEFAULT_DISPATCH_CONFIG.finalStageBehavior;

  if (source.finalStageBehavior && finalStageBehavior !== source.finalStageBehavior) {
    warnings.push(`Unknown finalStageBehavior "${source.finalStageBehavior}"; using "${finalStageBehavior}".`);
  }

  const fanoutRaw = toFiniteNumber(source.riderFanoutLimit);
  const riderFanoutLimit =
    fanoutRaw !== null && fanoutRaw > 0
      ? Math.floor(clamp(fanoutRaw, CONFIG_LIMITS.minFanout, CONFIG_LIMITS.maxFanout))
      : DEFAULT_DISPATCH_CONFIG.riderFanoutLimit;

  const countdownRaw = toFiniteNumber(source.offerCountdownSeconds);
  const offerCountdownSeconds =
    countdownRaw !== null && countdownRaw > 0
      ? Math.floor(clamp(countdownRaw, CONFIG_LIMITS.minTimeoutSeconds, CONFIG_LIMITS.maxTimeoutSeconds))
      : DEFAULT_DISPATCH_CONFIG.offerCountdownSeconds;

  const cooldownRaw = toFiniteNumber(source.timeoutCooldownSeconds);
  const timeoutCooldownSeconds =
    cooldownRaw !== null && cooldownRaw >= 0
      ? Math.floor(clamp(cooldownRaw, 0, 86400))
      : DEFAULT_DISPATCH_CONFIG.timeoutCooldownSeconds;

  const staleRaw = toFiniteNumber(source.staleGpsMinutes);
  const staleGpsMinutes =
    staleRaw !== null && staleRaw > 0
      ? clamp(staleRaw, 1, 1440)
      : DEFAULT_DISPATCH_CONFIG.staleGpsMinutes;

  const config = {
    dispatchMode: 'auto',
    radiusExpansionEnabled:
      typeof source.radiusExpansionEnabled === 'boolean'
        ? source.radiusExpansionEnabled
        : DEFAULT_DISPATCH_CONFIG.radiusExpansionEnabled,
    stages: stages.map((s) => ({ ...s, timeoutSeconds: offerCountdownSeconds })),
    maxRadiusKm,
    maxAttempts,
    crisisAfterStage,
    finalStageBehavior,
    riderFanoutLimit,
    offerCountdownSeconds,
    timeoutCooldownSeconds,
    staleGpsMinutes,
    includeStaleGpsRiders:
      typeof source.includeStaleGpsRiders === 'boolean'
        ? source.includeStaleGpsRiders
        : DEFAULT_DISPATCH_CONFIG.includeStaleGpsRiders,
    unboundedFallbackEnabled:
      typeof source.unboundedFallbackEnabled === 'boolean'
        ? source.unboundedFallbackEnabled
        : DEFAULT_DISPATCH_CONFIG.unboundedFallbackEnabled,
  };

  return { config, warnings, usedDefaults };
}

/**
 * Strict validation for the admin write path. Throws on anything an operator
 * should be told about rather than silently repairing it.
 *
 * @param {object} body
 * @returns {object} the normalized config that will be persisted
 */
export function validateDispatchConfigInput(body) {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('Dispatch configuration payload is required.');
  }

  if (body.stages !== undefined) {
    if (!Array.isArray(body.stages)) {
      throw new ValidationError('`stages` must be an array.');
    }
    if (body.stages.length < CONFIG_LIMITS.minStages) {
      throw new ValidationError('At least one dispatch stage is required.');
    }
    if (body.stages.length > CONFIG_LIMITS.maxStages) {
      throw new ValidationError(`At most ${CONFIG_LIMITS.maxStages} dispatch stages are allowed.`);
    }

    const seen = new Set();
    let previousRadius = 0;

    body.stages.forEach((stage, index) => {
      const label = `Stage ${index + 1}`;
      if (!stage || typeof stage !== 'object') {
        throw new ValidationError(`${label}: each stage must be an object with radiusKm.`);
      }

      const radiusKm = toFiniteNumber(stage.radiusKm);
      if (radiusKm === null) {
        throw new ValidationError(`${label}: radiusKm must be a number.`);
      }
      if (radiusKm <= 0) {
        throw new ValidationError(`${label}: radiusKm must be greater than 0.`);
      }
      if (radiusKm > CONFIG_LIMITS.maxRadiusKm) {
        throw new ValidationError(`${label}: radiusKm cannot exceed ${CONFIG_LIMITS.maxRadiusKm} km.`);
      }

      const radiusKey = radiusKm.toFixed(3);
      if (seen.has(radiusKey)) {
        throw new ValidationError(`${label}: duplicate radius ${radiusKm} km. Each stage needs a distinct radius.`);
      }
      seen.add(radiusKey);

      if (radiusKm <= previousRadius) {
        throw new ValidationError(
          `${label}: radius ${radiusKm} km must be larger than the previous stage (${previousRadius} km). Stages expand outward.`,
        );
      }
      previousRadius = radiusKm;

      if (stage.timeoutSeconds !== undefined) {
        const timeoutSeconds = toFiniteNumber(stage.timeoutSeconds);
        if (timeoutSeconds === null) {
          throw new ValidationError(`${label}: timeoutSeconds must be a number.`);
        }
        if (
          timeoutSeconds < CONFIG_LIMITS.minTimeoutSeconds ||
          timeoutSeconds > CONFIG_LIMITS.maxTimeoutSeconds
        ) {
          throw new ValidationError(
            `${label}: timeoutSeconds must be between ${CONFIG_LIMITS.minTimeoutSeconds} and ${CONFIG_LIMITS.maxTimeoutSeconds}.`,
          );
        }
      }
    });

    const maxRadiusKm = toFiniteNumber(body.maxRadiusKm);
    if (maxRadiusKm !== null) {
      if (maxRadiusKm <= 0) {
        throw new ValidationError('maxRadiusKm must be greater than 0.');
      }
      if (previousRadius > maxRadiusKm) {
        throw new ValidationError(
          `The widest stage (${previousRadius} km) exceeds maxRadiusKm (${maxRadiusKm} km). Raise the maximum or lower the stage.`,
        );
      }
    }
  }

  if (body.maxAttempts !== undefined && body.maxAttempts !== null) {
    const maxAttempts = toFiniteNumber(body.maxAttempts);
    if (maxAttempts === null || maxAttempts < 0) {
      throw new ValidationError('maxAttempts must be 0 (unlimited) or a positive number.');
    }
    if (maxAttempts > CONFIG_LIMITS.maxAttemptsCeiling) {
      throw new ValidationError(`maxAttempts cannot exceed ${CONFIG_LIMITS.maxAttemptsCeiling}.`);
    }
  }

  if (body.crisisAfterStage !== undefined && body.crisisAfterStage !== null) {
    const crisisAfterStage = toFiniteNumber(body.crisisAfterStage);
    if (crisisAfterStage === null || crisisAfterStage < 0) {
      throw new ValidationError('crisisAfterStage must be 0 (disabled) or a positive number.');
    }
  }

  if (
    body.finalStageBehavior !== undefined &&
    !FINAL_STAGE_BEHAVIORS.includes(body.finalStageBehavior)
  ) {
    throw new ValidationError(
      `finalStageBehavior must be one of: ${FINAL_STAGE_BEHAVIORS.join(', ')}.`,
    );
  }

  if (body.riderFanoutLimit !== undefined && body.riderFanoutLimit !== null) {
    const fanout = toFiniteNumber(body.riderFanoutLimit);
    if (fanout === null || fanout < CONFIG_LIMITS.minFanout || fanout > CONFIG_LIMITS.maxFanout) {
      throw new ValidationError(
        `riderFanoutLimit must be between ${CONFIG_LIMITS.minFanout} and ${CONFIG_LIMITS.maxFanout}.`,
      );
    }
  }

  if (body.offerCountdownSeconds !== undefined && body.offerCountdownSeconds !== null) {
    const countdown = toFiniteNumber(body.offerCountdownSeconds);
    if (
      countdown === null ||
      countdown < CONFIG_LIMITS.minTimeoutSeconds ||
      countdown > CONFIG_LIMITS.maxTimeoutSeconds
    ) {
      throw new ValidationError(
        `offerCountdownSeconds must be between ${CONFIG_LIMITS.minTimeoutSeconds} and ${CONFIG_LIMITS.maxTimeoutSeconds}.`,
      );
    }
  }

  const { config, warnings } = normalizeDispatchConfig({
    ...DEFAULT_DISPATCH_CONFIG,
    ...body,
    stages: body.stages ?? DEFAULT_DISPATCH_CONFIG.stages,
  });

  // Strict validation above should leave nothing to repair. If it did, the
  // normalizer and the validator have drifted apart - surface it rather than
  // persisting something the operator did not ask for.
  if (warnings.length > 0) {
    logger.warn(`Dispatch config accepted with normalization notes: ${warnings.join(' ')}`);
  }

  return config;
}

/**
 * Read the live dispatch configuration. Falls back to defaults on any failure -
 * dispatch must never stop because a settings document is missing or corrupt.
 *
 * @param {{ skipCache?: boolean }} [options]
 * @returns {Promise<object>}
 */
export async function getDispatchConfig(options = {}) {
  const load = async () => {
    try {
      const doc = await FoodSettings.findOne({ key: DISPATCH_SETTINGS_KEY }).lean();
      const { config, warnings } = normalizeDispatchConfig(doc?.dispatchConfig);
      if (warnings.length > 0) {
        logger.warn(
          `Stored dispatch configuration needed repair (dispatch continues): ${warnings.join(' ')}`,
        );
      }
      return config;
    } catch (err) {
      logger.error(
        `Failed to load dispatch configuration, using defaults: ${err?.message || err}`,
      );
      return normalizeDispatchConfig(null).config;
    }
  };

  if (options.skipCache) return load();
  return configCache.get(DISPATCH_SETTINGS_KEY, load);
}

/** Drop the cached configuration after an admin write. */
export function invalidateDispatchConfigCache() {
  configCache.delete(DISPATCH_SETTINGS_KEY);
}

/**
 * Map a 1-based attempt number onto a configured stage.
 *
 *   attempt 1 -> stages[0], attempt 2 -> stages[1], ...
 *
 * Once the ladder is exhausted the configured `finalStageBehavior` decides what
 * happens; the function never invents a radius of its own.
 *
 * @param {object} config Normalized configuration.
 * @param {number} attemptInput 1-based attempt number.
 */
export function resolveDispatchStage(config, attemptInput) {
  const parsed = Number(attemptInput);
  const attempt = Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 1;
  const stages = config.stages;
  const totalStages = stages.length;

  // Expansion off: every attempt reuses the first stage.
  if (!config.radiusExpansionEnabled) {
    const stage = stages[0];
    return {
      attempt,
      stageNumber: 1,
      stageIndex: 0,
      totalStages,
      radiusKm: stage.radiusKm,
      timeoutSeconds: stage.timeoutSeconds,
      timeoutMs: stage.timeoutSeconds * 1000,
      stagesExhausted: false,
      isFinalStage: true,
      shouldStop: config.maxAttempts > 0 && attempt > config.maxAttempts,
      isCrisis: config.crisisAfterStage > 0 && attempt > config.crisisAfterStage,
      reason: 'radius_expansion_disabled',
    };
  }

  const withinLadder = attempt <= totalStages;
  const stageIndex = withinLadder ? attempt - 1 : totalStages - 1;
  const stage = stages[stageIndex];
  const stagesExhausted = !withinLadder;

  let shouldStop = false;
  let reason = withinLadder ? 'stage' : `final_stage_${config.finalStageBehavior}`;

  if (stagesExhausted && config.finalStageBehavior === 'stop') {
    shouldStop = true;
  }

  if (config.maxAttempts > 0 && attempt > config.maxAttempts) {
    shouldStop = true;
    reason = 'max_attempts_reached';
  }

  const isCrisis =
    (config.crisisAfterStage > 0 && attempt > config.crisisAfterStage) ||
    (stagesExhausted && config.finalStageBehavior === 'crisis_only');

  return {
    attempt,
    stageNumber: withinLadder ? attempt : totalStages,
    stageIndex,
    totalStages,
    radiusKm: stage.radiusKm,
    timeoutSeconds: stage.timeoutSeconds,
    timeoutMs: stage.timeoutSeconds * 1000,
    stagesExhausted,
    isFinalStage: stageIndex === totalStages - 1,
    shouldStop,
    isCrisis,
    reason,
  };
}

/** Exclusions that never expire, regardless of cooldown policy. */
export const PERMANENT_EXCLUSION_ACTIONS = Object.freeze(['rejected', 'deassigned']);

/**
 * The instant before which a `timeout` entry has served its cooldown and the
 * rider becomes eligible again. Returns null when cooldown is disabled, meaning
 * timeouts are permanent (the legacy behaviour).
 *
 * @param {object} config Normalized dispatch config.
 * @param {Date} [now]
 * @returns {Date|null}
 */
export function timeoutCooldownCutoff(config, now = new Date()) {
  const seconds = Number(config?.timeoutCooldownSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(now.getTime() - seconds * 1000);
}

/**
 * Mongo filter fragment: "this partner is not currently barred from the order".
 *
 * One definition shared by the dispatcher, the accept guard and the available
 * list, so those three can never drift apart on who is eligible.
 *
 * @param {import('mongoose').Types.ObjectId} partnerId
 * @param {object} config Normalized dispatch config.
 */
export function buildPartnerNotBarredFilter(partnerId, config) {
  const cutoff = timeoutCooldownCutoff(config);

  // Cooldown disabled -> a timeout bars the rider forever, same as a rejection.
  if (!cutoff) {
    return {
      'dispatch.offeredTo': {
        $not: {
          $elemMatch: {
            partnerId,
            action: { $in: [...PERMANENT_EXCLUSION_ACTIONS, 'timeout'] },
          },
        },
      },
    };
  }

  return {
    $and: [
      {
        'dispatch.offeredTo': {
          $not: {
            $elemMatch: { partnerId, action: { $in: PERMANENT_EXCLUSION_ACTIONS } },
          },
        },
      },
      {
        // Only a RECENT timeout bars them. `respondedAt` missing is treated as
        // still-cooling, so historical rows written before the field existed do
        // not suddenly unbar everyone.
        'dispatch.offeredTo': {
          $not: {
            $elemMatch: {
              partnerId,
              action: 'timeout',
              $or: [
                { respondedAt: { $gt: cutoff } },
                { respondedAt: { $exists: false } },
              ],
            },
          },
        },
      },
    ],
  };
}

/**
 * In-memory equivalent of {@link buildPartnerNotBarredFilter}, for code that
 * already holds the offeredTo array.
 *
 * @returns {(partnerId: string) => boolean} true when the partner is barred
 */
export function buildPartnerBarredPredicate(offeredTo = [], config) {
  const cutoff = timeoutCooldownCutoff(config);
  const barred = new Set();

  for (const entry of offeredTo || []) {
    const pid = entry?.partnerId?.toString?.();
    if (!pid) continue;
    const action = String(entry.action || '');

    if (PERMANENT_EXCLUSION_ACTIONS.includes(action)) {
      barred.add(pid);
      continue;
    }
    if (action !== 'timeout') continue;

    if (!cutoff) {
      barred.add(pid);
      continue;
    }
    const respondedAt = entry.respondedAt ? new Date(entry.respondedAt) : null;
    if (!respondedAt || respondedAt > cutoff) barred.add(pid);
  }

  return (partnerId) => barred.has(String(partnerId));
}

/**
 * Persist a validated configuration. Returns the stored, normalized config.
 *
 * @param {object} input Raw admin payload.
 * @param {string} adminId
 */
export async function saveDispatchConfig(input, adminId) {
  const config = validateDispatchConfigInput(input);

  await FoodSettings.findOneAndUpdate(
    { key: DISPATCH_SETTINGS_KEY },
    {
      $set: {
        dispatchMode: 'auto',
        dispatchConfig: config,
        updatedBy: { role: 'ADMIN', adminId, at: new Date() },
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  invalidateDispatchConfigCache();
  logger.info(
    `Dispatch configuration updated by admin ${adminId}: ${config.stages.length} stages, ` +
      `radii [${config.stages.map((s) => s.radiusKm).join(', ')}] km, maxAttempts=${config.maxAttempts}, ` +
      `crisisAfterStage=${config.crisisAfterStage}, finalStageBehavior=${config.finalStageBehavior}`,
  );

  return config;
}
