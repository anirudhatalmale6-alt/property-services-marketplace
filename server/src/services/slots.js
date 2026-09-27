/**
 * Appointment slot availability.
 *
 * MVP rule set, deliberately simple and all in one place so it can grow into
 * per-provider calendars later without touching the booking routes:
 *  - business hours only, on the half hour
 *  - no slot inside the lead time (customers can't book 10 minutes out)
 *  - a slot is offered only if at least one approved provider covering that
 *    area and service is free for its whole duration
 *  - capacity is shown, so the UI can mark a slot as nearly full
 */
import { prisma } from '../db.js';

export const OPEN_HOUR = 7; // 07:00 first start
export const CLOSE_HOUR = 18; // last job must END by 18:00
export const SLOT_STEP_MINUTES = 30;
export const MIN_LEAD_MINUTES = 120;
export const MAX_DAYS_AHEAD = 30;

const minutes = (n) => n * 60_000;

/** Half-hourly start times for one local day that fit a job of `duration`. */
function candidateStarts(day, durationMinutes) {
  const out = [];
  const cursor = new Date(day);
  cursor.setHours(OPEN_HOUR, 0, 0, 0);

  const dayEnd = new Date(day);
  dayEnd.setHours(CLOSE_HOUR, 0, 0, 0);

  while (cursor.getTime() + minutes(durationMinutes) <= dayEnd.getTime()) {
    out.push(new Date(cursor));
    cursor.setMinutes(cursor.getMinutes() + SLOT_STEP_MINUTES);
  }
  return out;
}

/**
 * Availability for a service in an area over a date range.
 *
 * @param {object} opts
 * @param {string} opts.serviceId
 * @param {string} [opts.zip] used to resolve the market
 * @param {Date} opts.from
 * @param {number} [opts.days]
 * @returns {Promise<{area:object|null, slots:Array<{start:string,end:string,capacity:number}>}>}
 */
export async function getAvailability({ serviceId, zip, from, days = 14 }) {
  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    select: { id: true, durationMinutes: true, isActive: true },
  });
  if (!service || !service.isActive) return { area: null, slots: [] };

  const area = zip
    ? await prisma.serviceArea.findFirst({
        where: { zip: String(zip).trim(), isActive: true },
      })
    : null;

  // We only operate where there is a live ServiceArea row. No row, no slots —
  // this is what keeps "are you in my city?" an honest answer.
  if (zip && !area) return { area: null, slots: [] };

  const providers = await prisma.providerProfile.findMany({
    where: {
      status: 'APPROVED',
      services: { some: { serviceId } },
      ...(area ? { areas: { some: { serviceAreaId: area.id } } } : {}),
    },
    select: { id: true },
  });

  if (providers.length === 0) return { area, slots: [] };
  const providerIds = providers.map((p) => p.id);

  const rangeStart = new Date(from);
  rangeStart.setHours(0, 0, 0, 0);
  const rangeEnd = new Date(rangeStart);
  rangeEnd.setDate(rangeEnd.getDate() + Math.min(days, MAX_DAYS_AHEAD));

  // One query for every commitment in the window, rather than per slot.
  const committed = await prisma.job.findMany({
    where: {
      providerId: { in: providerIds },
      status: { in: ['ASSIGNED', 'EN_ROUTE', 'IN_PROGRESS', 'AWAITING_REPORT'] },
      scheduledStart: { lt: rangeEnd },
      scheduledEnd: { gt: rangeStart },
    },
    select: { providerId: true, scheduledStart: true, scheduledEnd: true },
  });

  const busyByProvider = new Map(providerIds.map((id) => [id, []]));
  for (const c of committed) {
    busyByProvider.get(c.providerId)?.push([c.scheduledStart.getTime(), c.scheduledEnd.getTime()]);
  }

  const earliest = Date.now() + minutes(MIN_LEAD_MINUTES);
  const slots = [];

  for (let d = 0; d < Math.min(days, MAX_DAYS_AHEAD); d += 1) {
    const day = new Date(rangeStart);
    day.setDate(day.getDate() + d);

    for (const start of candidateStarts(day, service.durationMinutes)) {
      const s = start.getTime();
      const e = s + minutes(service.durationMinutes);
      if (s < earliest) continue;

      const free = providerIds.filter((pid) =>
        (busyByProvider.get(pid) || []).every(([bs, be]) => s >= be || e <= bs),
      );

      if (free.length > 0) {
        slots.push({
          start: new Date(s).toISOString(),
          end: new Date(e).toISOString(),
          capacity: free.length,
        });
      }
    }
  }

  return { area, slots };
}

/**
 * Validate a slot a customer has submitted. The browser proposes; the server
 * decides — otherwise a stale page books 3am on a Sunday.
 *
 * @returns {{ok:true, start:Date, end:Date}|{ok:false, reason:string}}
 */
export async function validateSlot({ serviceId, zip, start }) {
  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    select: { durationMinutes: true, isActive: true },
  });
  if (!service?.isActive) return { ok: false, reason: 'That service is not available' };

  const s = new Date(start);
  if (Number.isNaN(s.getTime())) return { ok: false, reason: 'That appointment time is not valid' };

  const end = new Date(s.getTime() + minutes(service.durationMinutes));

  if (s.getTime() < Date.now() + minutes(MIN_LEAD_MINUTES)) {
    return {
      ok: false,
      reason: `Please choose a time at least ${MIN_LEAD_MINUTES / 60} hours from now`,
    };
  }

  const horizon = new Date();
  horizon.setDate(horizon.getDate() + MAX_DAYS_AHEAD);
  if (s > horizon) {
    return { ok: false, reason: `Bookings open ${MAX_DAYS_AHEAD} days ahead` };
  }

  if (s.getMinutes() % SLOT_STEP_MINUTES !== 0 || s.getSeconds() !== 0) {
    return { ok: false, reason: 'Appointments start on the hour or half hour' };
  }
  if (s.getHours() < OPEN_HOUR) {
    return { ok: false, reason: `Our earliest appointment is ${OPEN_HOUR}:00` };
  }
  const dayEnd = new Date(s);
  dayEnd.setHours(CLOSE_HOUR, 0, 0, 0);
  if (end > dayEnd) {
    return { ok: false, reason: `Appointments must finish by ${CLOSE_HOUR}:00` };
  }

  // Re-check capacity: someone may have taken the last provider since the page
  // loaded.
  const { slots } = await getAvailability({
    serviceId,
    zip,
    from: s,
    days: 1,
  });
  const match = slots.find((sl) => sl.start === s.toISOString());
  if (!match) {
    return { ok: false, reason: 'That time has just been taken — please pick another' };
  }

  return { ok: true, start: s, end };
}
