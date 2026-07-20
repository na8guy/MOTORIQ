import crypto from 'node:crypto';
import { request } from 'undici';
import { env } from '../../config/env.js';

/**
 * Awin affiliate network.
 *
 * ── WHAT AWIN IS, AND WHAT IT ISN'T ──
 * Awin is an affiliate network, not a booking system. You send a member to an
 * advertiser's own site with a tracked link; if they buy, the advertiser pays a
 * commission days or weeks later, after they validate the sale.
 *
 * That has two consequences the product has to respect:
 *
 *  1. THE MEMBER PAYS THE ADVERTISER, NOT US. So a membership perk — a Premium
 *     member's free MOT — CANNOT be applied to an affiliate booking. We are not
 *     the merchant and cannot discount someone else's checkout. Perk-backed
 *     work therefore stays on the direct-partnership path in marketplace/.
 *
 *  2. THERE ARE NO LIVE SERVICE PRICES. The API returns programmes and
 *     transactions, not "what does an MOT cost at this branch today". The
 *     price comparison in quotes.service.ts cannot be powered by Awin.
 *
 * Where Awin is genuinely excellent is insurance. We are not FCA-authorised and
 * cannot quote premiums, but the aggregators already are — so an affiliate link
 * turns a screen that could only ever give advice into one that earns, legally.
 *
 * API notes: OAuth 2.0 bearer token (a personal token from the Awin UI, not a
 * client-credentials exchange), base https://api.awin.com, and a hard limit of
 * 20 calls per minute per user — which is why commissions are synced on a
 * schedule rather than per request.
 */

/** Awin's documented throttle. Exceeding it gets the account rate-limited. */
const RATE_LIMIT_PER_MIN = 20;

export interface AwinProgramme {
  advertiserId: string;
  name: string;
  /** 'joined' | 'pending' | 'notjoined' — only joined programmes can be linked. */
  relationship: string;
  displayUrl?: string;
  /** What the advertiser pays, as published on the programme. */
  commissionRange?: string;
}

export interface AwinTransaction {
  id: string;
  advertiserId: string;
  advertiserName: string;
  /** 'pending' | 'approved' | 'declined' */
  commissionStatus: string;
  saleAmount: number;
  commissionAmount: number;
  currency: string;
  transactionDate: string;
  validationDate?: string | null;
  /** Our own reference, returned verbatim — the thread back to the member. */
  clickRef?: string | null;
}

class AwinClient {
  private calls: number[] = [];

  get isLive(): boolean {
    return !!env.AWIN_API_TOKEN && !!env.AWIN_PUBLISHER_ID;
  }

  /**
   * Build a tracked deep link.
   *
   * Deliberately NOT an API call — Awin's link format is a documented URL
   * shape, so generating it locally means a member never waits on a network
   * round trip just to tap "get a quote", and we never burn one of our 20
   * calls a minute on something that is pure string construction.
   *
   * `clickRef` is ours to choose and comes back verbatim on the transaction.
   * It is the only way to know WHICH member earned a commission, so it is
   * always set, even when we do not yet have a use for the attribution.
   */
  buildTrackedLink(params: {
    advertiserId: string;
    destinationUrl: string;
    clickRef: string;
  }): string {
    const affid = env.AWIN_PUBLISHER_ID ?? '0';
    const qs = new URLSearchParams({
      awinmid: params.advertiserId,
      awinaffid: affid,
      clickref: params.clickRef,
      ued: params.destinationUrl,
    });
    return `https://www.awin1.com/cread.php?${qs.toString()}`;
  }

  /** A reference that is unique, unguessable and carries no personal data. */
  newClickRef(): string {
    return `sod_${crypto.randomBytes(9).toString('base64url')}`;
  }

  /** Programmes we have joined — the advertisers we may actually link to. */
  async programmes(): Promise<AwinProgramme[]> {
    if (!this.isLive) return [];
    const data = await this.get<
      { id: number; name: string; relationship: string; displayUrl?: string }[]
    >(`/publishers/${env.AWIN_PUBLISHER_ID}/programmes?relationship=joined`);
    if (!data) return [];
    return data.map((p) => ({
      advertiserId: String(p.id),
      name: p.name,
      relationship: p.relationship,
      displayUrl: p.displayUrl,
    }));
  }

  /**
   * Commissions in a date window.
   *
   * Awin caps a single request at roughly a month, and statuses change after
   * the fact — a pending commission can still be declined — so the sync
   * deliberately re-reads a trailing window rather than only fetching what is
   * new. See syncCommissions().
   */
  async transactions(since: Date, until: Date): Promise<AwinTransaction[]> {
    if (!this.isLive) return [];
    const qs = new URLSearchParams({
      startDate: since.toISOString().slice(0, 19),
      endDate: until.toISOString().slice(0, 19),
      timezone: 'Europe/London',
      dateType: 'transaction',
    });
    const data = await this.get<
      {
        id: number;
        advertiserId: number;
        advertiserName?: string;
        commissionStatus: string;
        saleAmount?: { amount: number; currency: string };
        commissionAmount?: { amount: number; currency: string };
        transactionDate: string;
        validationDate?: string | null;
        clickRefs?: { clickRef?: string };
        clickRef?: string | null;
      }[]
    >(`/publishers/${env.AWIN_PUBLISHER_ID}/transactions/?${qs.toString()}`);
    if (!data) return [];

    return data.map((t) => ({
      id: String(t.id),
      advertiserId: String(t.advertiserId),
      advertiserName: t.advertiserName ?? `Advertiser ${t.advertiserId}`,
      commissionStatus: (t.commissionStatus ?? 'pending').toLowerCase(),
      saleAmount: t.saleAmount?.amount ?? 0,
      commissionAmount: t.commissionAmount?.amount ?? 0,
      currency: t.commissionAmount?.currency ?? t.saleAmount?.currency ?? 'GBP',
      transactionDate: t.transactionDate,
      validationDate: t.validationDate ?? null,
      clickRef: t.clickRefs?.clickRef ?? t.clickRef ?? null,
    }));
  }

  /**
   * Awin allows 20 calls a minute per user. Exceeding it rate-limits the whole
   * account, which would break the sync for everyone — so we self-throttle
   * rather than find out the hard way.
   */
  private async throttle(): Promise<void> {
    const now = Date.now();
    this.calls = this.calls.filter((t) => now - t < 60_000);
    if (this.calls.length >= RATE_LIMIT_PER_MIN) {
      const wait = 60_000 - (now - this.calls[0]!) + 250;
      console.warn(`[awin] rate limit reached — pausing ${Math.round(wait / 1000)}s`);
      await new Promise((r) => setTimeout(r, wait));
      return this.throttle();
    }
    this.calls.push(now);
  }

  private async get<T>(path: string): Promise<T | null> {
    await this.throttle();
    try {
      const res = await request(`${env.AWIN_BASE_URL}${path}`, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${env.AWIN_API_TOKEN}`,
          accept: 'application/json',
        },
        headersTimeout: 15_000,
        bodyTimeout: 15_000,
      });
      if (res.statusCode === 401) {
        console.error('[awin] 401 — AWIN_API_TOKEN is missing, wrong or expired');
        res.body.dump();
        return null;
      }
      if (res.statusCode === 429) {
        console.warn('[awin] 429 — throttled by Awin despite self-limiting');
        res.body.dump();
        return null;
      }
      if (res.statusCode >= 400) {
        const body = await res.body.text();
        console.warn(`[awin] ${res.statusCode} on ${path}: ${body.slice(0, 160)}`);
        return null;
      }
      return (await res.body.json()) as T;
    } catch (err) {
      console.warn(`[awin] request failed: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }
}

export const awin = new AwinClient();
