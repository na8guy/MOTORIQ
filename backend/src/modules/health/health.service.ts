import { prisma } from '../../lib/prisma.js';

/**
 * Vehicle Health Report.
 *
 * ── WHAT THIS IS, AND ISN'T ──
 * This is NOT a diagnosis. We have no OBD connection and no sensor data; what
 * we actually hold is MOT status and expiry, tax status, mileage, age and
 * reminder state. So the report reasons about *compliance and risk from known
 * facts*, and every finding says which fact it came from.
 *
 * That distinction matters. "Your clutch is failing" from mileage alone would
 * be a guess dressed as expertise, and the first time it was wrong the member
 * would stop believing any of it. "Your MOT expires in 9 days" is certain,
 * actionable, and worth money — that is the report's job.
 *
 * When telematics or OBD arrives, genuine prediction can be added on top; the
 * findings already carry a `basis` field so real sensor findings and inferred
 * ones can never be confused.
 */

export type Severity = 'URGENT' | 'ATTENTION' | 'INFO' | 'GOOD';

export interface Finding {
  code: string;
  severity: Severity;
  title: string;
  detail: string;
  /** Where this came from — never let inference pass as measurement. */
  basis: 'DVLA' | 'DVSA' | 'MILEAGE' | 'AGE' | 'MEMBER';
}

export interface Action {
  title: string;
  detail: string;
  /** Estimated cost in pence, when we can reasonably say. */
  estimatedMinor?: number;
  /** Which marketplace service books this, if any. */
  bookable?: 'MOT' | 'SERVICE' | 'TYRES' | 'REPAIR';
  urgency: 'NOW' | 'SOON' | 'PLAN';
}

export interface HealthReport {
  vehicleId: string;
  registration: string;
  score: number;
  band: 'GOOD' | 'ATTENTION' | 'URGENT';
  findings: Finding[];
  actions: Action[];
  estimatedCostMinor: number;
  generatedAt: string;
}

const DAY = 24 * 60 * 60 * 1000;
const daysUntil = (d: Date | null): number | null =>
  d ? Math.ceil((d.getTime() - Date.now()) / DAY) : null;

export async function generateReport(userId: string, vehicleId: string): Promise<HealthReport | null> {
  const v = await prisma.vehicle.findFirst({ where: { id: vehicleId, userId } });
  if (!v) return null;

  const findings: Finding[] = [];
  const actions: Action[] = [];

  // Start at 100 and deduct for what we actually know to be wrong. Starting
  // low and adding would make an unknown vehicle look unhealthy, which is a
  // different (and false) claim.
  let score = 100;

  // ── MOT ──
  const motDays = daysUntil(v.motExpiryDate);
  if (v.motExpiryDate == null) {
    findings.push({
      code: 'MOT_UNKNOWN',
      severity: 'INFO',
      title: 'No MOT date on file',
      detail:
        'We have no MOT expiry for this vehicle. That is normal for a car under three years old, ' +
        'which does not need one yet.',
      basis: 'DVSA',
    });
  } else if (motDays !== null && motDays < 0) {
    score -= 40;
    findings.push({
      code: 'MOT_EXPIRED',
      severity: 'URGENT',
      title: `MOT expired ${Math.abs(motDays)} days ago`,
      detail:
        'Driving without a valid MOT can mean a £1,000 fine, and your insurance may not pay out. ' +
        'This needs sorting before you drive again.',
      basis: 'DVSA',
    });
    actions.push({
      title: 'Book an MOT now',
      detail: 'Your MOT has expired — this is the most urgent thing on the list.',
      estimatedMinor: 5500,
      bookable: 'MOT',
      urgency: 'NOW',
    });
  } else if (motDays !== null && motDays <= 30) {
    score -= 12;
    findings.push({
      code: 'MOT_DUE_SOON',
      severity: 'ATTENTION',
      title: `MOT expires in ${motDays} days`,
      detail: 'You can MOT a car up to a month early and keep the same renewal date.',
      basis: 'DVSA',
    });
    actions.push({
      title: 'Book your MOT',
      detail: 'Booking early keeps your renewal date and avoids a scramble.',
      estimatedMinor: 5500,
      bookable: 'MOT',
      urgency: 'SOON',
    });
  } else if (motDays !== null) {
    findings.push({
      code: 'MOT_OK',
      severity: 'GOOD',
      title: `MOT valid for ${motDays} more days`,
      detail: 'Nothing to do.',
      basis: 'DVSA',
    });
  }

  // ── Road tax ──
  const taxDays = daysUntil(v.taxDueDate);
  if (v.taxStatus && v.taxStatus.toLowerCase().includes('untaxed')) {
    score -= 30;
    findings.push({
      code: 'UNTAXED',
      severity: 'URGENT',
      title: 'This vehicle is showing as untaxed',
      detail: 'DVLA records it as untaxed. Driving untaxed risks a fine and clamping.',
      basis: 'DVLA',
    });
    actions.push({
      title: 'Tax the vehicle',
      detail: 'Do it at gov.uk — it takes a couple of minutes.',
      urgency: 'NOW',
    });
  } else if (taxDays !== null && taxDays <= 30 && taxDays >= 0) {
    score -= 8;
    findings.push({
      code: 'TAX_DUE_SOON',
      severity: 'ATTENTION',
      title: `Road tax due in ${taxDays} days`,
      detail: 'Set it to renew automatically and it stops being something to remember.',
      basis: 'DVLA',
    });
  }

  // ── Insurance (member-entered — no public API publishes this) ──
  const insDays = daysUntil(v.insuranceRenewalDate);
  if (insDays !== null && insDays <= 30 && insDays >= 0) {
    findings.push({
      code: 'INSURANCE_RENEWAL',
      severity: 'ATTENTION',
      title: `Insurance renews in ${insDays} days`,
      detail:
        'Renewal quotes are usually the worst price you will be offered. Shopping around ' +
        'at three to four weeks out typically beats auto-renewal.',
      basis: 'MEMBER',
    });
    actions.push({
      title: 'Compare insurance before it renews',
      detail: 'Auto-renewal is usually more expensive than a fresh quote.',
      urgency: 'SOON',
    });
  }

  // ── Servicing, from mileage and age ──
  const age = v.year ? new Date().getUTCFullYear() - v.year : null;
  if (v.serviceDueDate) {
    const svcDays = daysUntil(v.serviceDueDate);
    if (svcDays !== null && svcDays < 0) {
      score -= 10;
      findings.push({
        code: 'SERVICE_OVERDUE',
        severity: 'ATTENTION',
        title: `Service overdue by ${Math.abs(svcDays)} days`,
        detail: 'Skipping services shortens engine life and can affect a warranty.',
        basis: 'MEMBER',
      });
      actions.push({
        title: 'Book a service',
        detail: 'Overdue servicing costs more in the long run than it saves.',
        estimatedMinor: 14900,
        bookable: 'SERVICE',
        urgency: 'SOON',
      });
    }
  } else if (v.mileage != null && v.mileage > 0) {
    // No service date on file: infer from mileage, and label the inference.
    const sinceService = v.mileage % 12_000;
    if (sinceService > 10_000) {
      findings.push({
        code: 'SERVICE_LIKELY_DUE',
        severity: 'INFO',
        title: 'A service may be due',
        detail:
          `At ${v.mileage.toLocaleString()} miles you are probably near a service interval. ` +
          'We are estimating from mileage — add your last service date for a real answer.',
        basis: 'MILEAGE',
      });
    }
  }

  if (age != null && age >= 10) {
    findings.push({
      code: 'OLDER_VEHICLE',
      severity: 'INFO',
      title: `${age} years old`,
      detail:
        'Older cars fail MOTs more often, most commonly on brakes, tyres and suspension. ' +
        'Worth a look before the test rather than after.',
      basis: 'AGE',
    });
  }

  // High mileage is context, not a fault.
  if (v.mileage != null && v.mileage > 100_000) {
    findings.push({
      code: 'HIGH_MILEAGE',
      severity: 'INFO',
      title: `${v.mileage.toLocaleString()} miles`,
      detail: 'High mileage is fine when maintained — regular servicing matters more than the number.',
      basis: 'MILEAGE',
    });
  }

  if (findings.every((f) => f.severity === 'GOOD' || f.severity === 'INFO')) {
    findings.unshift({
      code: 'ALL_CLEAR',
      severity: 'GOOD',
      title: 'Nothing needs attention',
      detail: 'MOT and tax are in order and no dates are close. We will tell you when that changes.',
      basis: 'DVLA',
    });
  }

  score = Math.max(0, Math.min(100, score));
  const band: HealthReport['band'] = score >= 80 ? 'GOOD' : score >= 50 ? 'ATTENTION' : 'URGENT';
  const estimatedCostMinor = actions.reduce((sum, a) => sum + (a.estimatedMinor ?? 0), 0);

  const report: HealthReport = {
    vehicleId: v.id,
    registration: v.registration,
    score,
    band,
    findings,
    actions,
    estimatedCostMinor,
    generatedAt: new Date().toISOString(),
  };

  await prisma.vehicleHealthReport.create({
    data: {
      userId,
      vehicleId: v.id,
      score,
      band,
      findings: findings as unknown as object,
      actions: actions as unknown as object,
      estimatedCostMinor,
    },
  });

  return report;
}
