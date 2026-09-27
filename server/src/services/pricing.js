/**
 * Pricing and payout rules.
 *
 * SOP §3.6 — "System calculates/displays price according to configurable
 * pricing rules."
 * SOP §10 — "The system must not hard-code a fixed fee percentage. Admin must
 * be able to configure pricing and inspector payout/platform fee rules."
 *
 * So there is no percentage literal anywhere in this file's logic. The split
 * comes from, in order of precedence:
 *   1. the service's own payoutPercentBp / providerPayCents, if set
 *   2. the global `payout.defaultPercentBp` Setting
 *   3. DEFAULT_PAYOUT_BP below — a last-resort fallback so a missing setting
 *      cannot produce a zero payout, not a business assumption
 *
 * Every quote returns an itemised breakdown. That breakdown is stored on the
 * job, so "why was I charged $585?" is answered from what actually happened
 * rather than by re-running today's rules against yesterday's booking.
 */
import { prisma } from '../db.js';

/**
 * Fallback only. Reached when the business has never set a split — better to
 * pay the inspector most of the fee than to silently pay them nothing.
 */
export const DEFAULT_PAYOUT_BP = 8000; // 80.00%

export const SETTING_DEFAULT_PAYOUT_BP = 'payout.defaultPercentBp';

const bpToCents = (cents, bp) => Math.round((cents * bp) / 10_000);

/** The configured global split, or the fallback. */
export async function getDefaultPayoutBp(tx) {
  const client = tx || prisma;
  const row = await client.setting.findUnique({ where: { key: SETTING_DEFAULT_PAYOUT_BP } });
  const bp = Number.parseInt(row?.value ?? '', 10);
  if (!Number.isFinite(bp) || bp < 0 || bp > 10_000) return DEFAULT_PAYOUT_BP;
  return bp;
}

export async function setDefaultPayoutBp(bp) {
  const value = String(Math.round(bp));
  return prisma.setting.upsert({
    where: { key: SETTING_DEFAULT_PAYOUT_BP },
    create: { key: SETTING_DEFAULT_PAYOUT_BP, value },
    update: { value },
  });
}

/**
 * Which add-ons a service offers, for the booking form.
 * @returns {Promise<Array<{id,label,amountCents}>>}
 */
export async function getAddOns(serviceId) {
  const rules = await prisma.servicePriceRule.findMany({
    where: { serviceId, kind: 'ADD_ON', isActive: true },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, label: true, amountCents: true },
  });
  return rules;
}

/**
 * Quote a job.
 *
 * @param {object} opts
 * @param {object} opts.service          the Service row (with priceRules loaded, or not)
 * @param {number} [opts.squareFeet]
 * @param {number} [opts.yearBuilt]
 * @param {string[]} [opts.addOnIds]     ServicePriceRule ids of kind ADD_ON
 * @param {object} [opts.tx]
 * @returns {Promise<{priceCents:number, providerPayCents:number, platformFeeCents:number, breakdown:object}>}
 */
export async function quote({ service, squareFeet, yearBuilt, addOnIds = [], tx } = {}) {
  const client = tx || prisma;

  const rules =
    service.priceRules ??
    (await client.servicePriceRule.findMany({
      where: { serviceId: service.id, isActive: true },
      orderBy: { sortOrder: 'asc' },
    }));
  const active = rules.filter((r) => r.isActive !== false);

  const lines = [
    { code: 'BASE', label: `${service.name} — base`, amountCents: service.basePriceCents },
  ];

  // --- square footage band -------------------------------------------------
  // Exactly one tier may apply. If the property is larger than every band, the
  // widest band still applies rather than silently charging only the base —
  // an unpriced 6,000 sq ft house is a loss, not a free upgrade.
  if (service.collectsSquareFeet && Number.isFinite(squareFeet)) {
    const tiers = active
      .filter((r) => r.kind === 'SQFT_TIER')
      .sort((a, b) => (a.minValue ?? 0) - (b.minValue ?? 0));

    let tier = tiers.find(
      (r) =>
        squareFeet >= (r.minValue ?? 0) &&
        (r.maxValue === null || r.maxValue === undefined || squareFeet <= r.maxValue),
    );
    if (!tier && tiers.length) {
      const widest = tiers[tiers.length - 1];
      if (squareFeet > (widest.maxValue ?? Number.POSITIVE_INFINITY)) tier = widest;
    }

    if (tier && tier.amountCents !== 0) {
      lines.push({
        code: 'SQFT',
        ruleId: tier.id,
        label: tier.label,
        amountCents: tier.amountCents,
      });
    }
  }

  // --- age surcharge -------------------------------------------------------
  if (service.collectsYearBuilt && Number.isFinite(yearBuilt)) {
    // Derive age from the booking year, not a hard-coded "now" assumption.
    const age = new Date().getFullYear() - yearBuilt;
    const ageRules = active
      .filter((r) => r.kind === 'AGE_OVER' && age >= (r.minValue ?? 0))
      .sort((a, b) => (b.minValue ?? 0) - (a.minValue ?? 0));

    // Only the highest matching band applies — they are not cumulative.
    const hit = ageRules[0];
    if (hit && hit.amountCents !== 0) {
      lines.push({ code: 'AGE', ruleId: hit.id, label: hit.label, amountCents: hit.amountCents });
    }
  }

  // --- add-ons -------------------------------------------------------------
  if (addOnIds.length) {
    const byId = new Map(active.filter((r) => r.kind === 'ADD_ON').map((r) => [r.id, r]));
    // Deduplicate: the same add-on submitted twice must not be charged twice.
    for (const id of [...new Set(addOnIds)]) {
      const rule = byId.get(id);
      if (!rule) continue; // an unknown or retired add-on is ignored, never guessed at
      lines.push({ code: 'ADD_ON', ruleId: rule.id, label: rule.label, amountCents: rule.amountCents });
    }
  }

  const priceCents = lines.reduce((sum, l) => sum + l.amountCents, 0);

  // --- payout --------------------------------------------------------------
  let providerPayCents;
  let payoutRule;

  if (service.payoutMode === 'FIXED') {
    providerPayCents = service.providerPayCents ?? 0;
    payoutRule = { mode: 'FIXED', amountCents: providerPayCents };
  } else {
    const bp = service.payoutPercentBp ?? (await getDefaultPayoutBp(client));
    providerPayCents = bpToCents(priceCents, bp);
    payoutRule = {
      mode: 'PERCENT',
      percentBp: bp,
      percentLabel: `${(bp / 100).toFixed(2)}%`,
      source: service.payoutPercentBp != null ? 'service' : 'global default',
    };
  }

  // The platform can never owe more than it collected.
  if (providerPayCents > priceCents) providerPayCents = priceCents;
  if (providerPayCents < 0) providerPayCents = 0;

  return {
    priceCents,
    providerPayCents,
    platformFeeCents: priceCents - providerPayCents,
    breakdown: {
      lines,
      priceCents,
      providerPayCents,
      platformFeeCents: priceCents - providerPayCents,
      payoutRule,
      quotedAt: new Date().toISOString(),
    },
  };
}

/**
 * Validate the property details a customer submitted against what the service
 * actually asks for. Returns a list of field errors, empty when fine.
 */
export function validatePropertyDetails(service, { squareFeet, yearBuilt }) {
  const errors = [];
  const thisYear = new Date().getFullYear();

  if (service.collectsSquareFeet) {
    if (!Number.isFinite(squareFeet)) {
      errors.push({ field: 'squareFeet', message: 'Please give the approximate square footage' });
    } else if (squareFeet < 100 || squareFeet > 50_000) {
      errors.push({ field: 'squareFeet', message: 'That square footage does not look right' });
    }
  }

  if (service.collectsYearBuilt) {
    if (!Number.isFinite(yearBuilt)) {
      errors.push({ field: 'yearBuilt', message: 'Please give the year the property was built' });
    } else if (yearBuilt < 1800 || yearBuilt > thisYear) {
      errors.push({ field: 'yearBuilt', message: `Enter a year between 1800 and ${thisYear}` });
    }
  }

  return errors;
}
