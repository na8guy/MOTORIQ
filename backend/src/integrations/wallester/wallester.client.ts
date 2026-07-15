import crypto from 'node:crypto';
import { request } from 'undici';
import { env } from '../../config/env.js';
import { UpstreamError } from '../../lib/errors.js';

/**
 * Wallester Card Issuing API client.
 * Docs: https://api-doc.wallester.com
 *
 * Wallester authenticates each request with:
 *   - `Api-Key`      : your audience API key
 *   - `Api-Version`  : API version (e.g. "6.0")
 *   - `Timestamp`    : RFC3339 timestamp
 *   - `Signature`    : base64 RSA-SHA256 signature over
 *                      `${method}\n${path}\n${timestamp}\n${body}`
 *
 * The exact header/canonicalisation must be confirmed against the live
 * docs + the credentials Wallester issues you. Signing is isolated in
 * `signRequest()` so it is trivial to adjust in one place.
 *
 * When WALLESTER_MOCK=true (default) all calls return deterministic
 * fake data so the whole platform runs without live credentials.
 */

export interface WallesterAccount {
  id: string;
  currency: string;
  balanceMinor: number;
}

export interface WallesterCard {
  id: string;
  last4: string;
  status: 'PENDING' | 'ACTIVE' | 'FROZEN' | 'CLOSED';
  expiryMonth: number;
  expiryYear: number;
  brand: string;
}

class WallesterClient {
  private readonly mock = env.WALLESTER_MOCK;

  // ── Public API ───────────────────────────────────────────────

  async createAccount(params: { externalId: string; currency?: string }): Promise<WallesterAccount> {
    const currency = params.currency ?? env.WALLESTER_DEFAULT_CURRENCY;
    if (this.mock) {
      return { id: this.fakeId('acc', params.externalId), currency, balanceMinor: 0 };
    }
    const res = await this.call<{ account: RawAccount }>('POST', '/v1/accounts', {
      program_id: env.WALLESTER_PROGRAM_ID,
      external_id: params.externalId,
      currency,
    });
    return this.mapAccount(res.account);
  }

  async getBalance(accountId: string): Promise<number> {
    if (this.mock) return 0;
    const res = await this.call<{ account: RawAccount }>('GET', `/v1/accounts/${accountId}`);
    return res.account.available_amount ?? 0;
  }

  /** Load funds onto the account (wallet top-up). */
  async topUp(params: { accountId: string; amountMinor: number; reference: string }): Promise<void> {
    if (this.mock) return;
    await this.call('POST', `/v1/accounts/${params.accountId}/deposits`, {
      amount: params.amountMinor,
      reference: params.reference,
    });
  }

  async issueVirtualCard(params: {
    accountId: string;
    cardholderName: string;
    externalId: string;
  }): Promise<WallesterCard> {
    if (this.mock) {
      const now = new Date();
      return {
        id: this.fakeId('card', params.externalId),
        last4: String(1000 + (this.hash(params.externalId) % 9000)),
        status: 'ACTIVE',
        expiryMonth: now.getMonth() + 1,
        expiryYear: now.getFullYear() + 3,
        brand: 'Mastercard',
      };
    }
    const res = await this.call<{ card: RawCard }>('POST', '/v1/cards', {
      account_id: params.accountId,
      product_id: env.WALLESTER_CARD_PRODUCT_ID,
      type: 'virtual',
      external_id: params.externalId,
      cardholder: { name: params.cardholderName },
    });
    return this.mapCard(res.card);
  }

  async setCardStatus(cardId: string, status: 'ACTIVE' | 'FROZEN' | 'CLOSED'): Promise<void> {
    if (this.mock) return;
    // Wallester uses distinct endpoints per action (freeze/unfreeze/close).
    const action = status === 'ACTIVE' ? 'unblock' : status === 'FROZEN' ? 'block' : 'close';
    await this.call('POST', `/v1/cards/${cardId}/${action}`);
  }

  // ── KYC / identity verification ──────────────────────────────
  // The banking partner runs the regulated AML/KYC. We submit the
  // applicant and poll status. In mock mode we auto-approve unless the
  // applicant is under 18 (a simple deterministic rule for testing).

  async submitKyc(params: {
    externalId: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string; // ISO
    country: string;
    documentType: string;
    documentNumber: string;
  }): Promise<{ id: string; status: 'PENDING' | 'VERIFIED' | 'REJECTED'; reason?: string }> {
    if (this.mock) {
      const dob = new Date(params.dateOfBirth);
      const age = (Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000);
      if (Number.isFinite(age) && age < 18) {
        return { id: this.fakeId('kyc', params.externalId), status: 'REJECTED', reason: 'Applicant must be 18 or over' };
      }
      return { id: this.fakeId('kyc', params.externalId), status: 'VERIFIED' };
    }
    const res = await this.call<{ applicant: { id: string; status: string; reason?: string } }>(
      'POST',
      '/v1/kyc/applicants',
      {
        program_id: env.WALLESTER_PROGRAM_ID,
        external_id: params.externalId,
        first_name: params.firstName,
        last_name: params.lastName,
        date_of_birth: params.dateOfBirth,
        country: params.country,
        document: { type: params.documentType, number: params.documentNumber },
      },
    );
    return {
      id: res.applicant.id,
      status: (res.applicant.status?.toUpperCase() as 'PENDING' | 'VERIFIED' | 'REJECTED') ?? 'PENDING',
      reason: res.applicant.reason,
    };
  }

  async getKycStatus(kycId: string): Promise<'PENDING' | 'VERIFIED' | 'REJECTED'> {
    if (this.mock) return 'VERIFIED';
    const res = await this.call<{ applicant: { status: string } }>('GET', `/v1/kyc/applicants/${kycId}`);
    return (res.applicant.status?.toUpperCase() as 'PENDING' | 'VERIFIED' | 'REJECTED') ?? 'PENDING';
  }

  // ── HTTP + signing ───────────────────────────────────────────

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${env.WALLESTER_BASE_URL}${path}`;
    const rawBody = body ? JSON.stringify(body) : '';
    const timestamp = new Date().toISOString();

    try {
      const res = await request(url, {
        method: method as never,
        headers: {
          'content-type': 'application/json',
          'api-key': env.WALLESTER_API_KEY ?? '',
          'api-version': env.WALLESTER_API_VERSION,
          timestamp,
          signature: this.signRequest(method, path, timestamp, rawBody),
        },
        body: rawBody || undefined,
      });

      if (res.statusCode >= 400) {
        const errBody = await res.body.text();
        throw UpstreamError(`Wallester ${method} ${path} failed (${res.statusCode})`, errBody);
      }
      return (await res.body.json()) as T;
    } catch (err) {
      if (err instanceof Error && err.name === 'AppError') throw err;
      throw UpstreamError('Wallester request failed', String(err));
    }
  }

  private signRequest(method: string, path: string, timestamp: string, body: string): string {
    if (!env.WALLESTER_PRIVATE_KEY) return '';
    const message = `${method.toUpperCase()}\n${path}\n${timestamp}\n${body}`;
    const key = env.WALLESTER_PRIVATE_KEY.replace(/\\n/g, '\n');
    return crypto.createSign('RSA-SHA256').update(message).sign(key, 'base64');
  }

  // ── Mock helpers ─────────────────────────────────────────────

  private hash(input: string): number {
    return Math.abs(
      [...input].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) | 0, 7),
    );
  }

  private fakeId(prefix: string, seed: string): string {
    return `${prefix}_mock_${this.hash(seed).toString(16)}`;
  }

  private mapAccount(a: RawAccount): WallesterAccount {
    return { id: a.id, currency: a.currency, balanceMinor: a.available_amount ?? 0 };
  }

  private mapCard(c: RawCard): WallesterCard {
    return {
      id: c.id,
      last4: c.last_four ?? '0000',
      status: (c.status?.toUpperCase() as WallesterCard['status']) ?? 'PENDING',
      expiryMonth: c.expiry_month ?? 1,
      expiryYear: c.expiry_year ?? new Date().getFullYear() + 3,
      brand: c.brand ?? 'Mastercard',
    };
  }
}

interface RawAccount {
  id: string;
  currency: string;
  available_amount?: number;
}
interface RawCard {
  id: string;
  last_four?: string;
  status?: string;
  expiry_month?: number;
  expiry_year?: number;
  brand?: string;
}

export const wallester = new WallesterClient();
