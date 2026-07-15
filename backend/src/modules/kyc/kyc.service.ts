import { prisma } from '../../lib/prisma.js';
import { Forbidden } from '../../lib/errors.js';
import { wallester } from '../../integrations/wallester/wallester.client.js';
import { notify } from '../notifications/notifications.service.js';
import type { KycStatus } from '@prisma/client';

/**
 * Financial actions (wallet top-up/spend, card issuance) are gated on a
 * VERIFIED KYC profile. Call this at the top of those flows.
 */
export async function requireVerifiedKyc(userId: string): Promise<void> {
  const kyc = await prisma.kycProfile.findUnique({ where: { userId } });
  if (!kyc || kyc.status !== 'VERIFIED') {
    throw Forbidden('Identity verification (KYC) is required before you can do this');
  }
}

export async function getKyc(userId: string) {
  return prisma.kycProfile.findUnique({ where: { userId } });
}

export async function submitKyc(params: {
  userId: string;
  dateOfBirth: Date;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  postcode: string;
  country?: string;
  nationality?: string;
  documentType: string;
  documentNumber: string;
}) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: params.userId } });

  const result = await wallester.submitKyc({
    externalId: `kyc_${params.userId}`,
    firstName: user.firstName ?? 'Member',
    lastName: user.lastName ?? 'MOTORIQ',
    dateOfBirth: params.dateOfBirth.toISOString().slice(0, 10),
    country: params.country ?? 'GB',
    documentType: params.documentType,
    documentNumber: params.documentNumber,
  });

  const status = result.status as KycStatus;

  if (status === 'VERIFIED') {
    await notify(params.userId, {
      title: 'Identity verified',
      body: 'You are fully verified — your MOTORIQ wallet and Mastercard are ready to use.',
      type: 'KYC',
    });
  } else if (status === 'REJECTED') {
    await notify(params.userId, {
      title: 'Identity check failed',
      body: `We couldn't verify your identity${result.reason ? `: ${result.reason}` : ''}.`,
      type: 'KYC',
    });
  }

  return prisma.kycProfile.upsert({
    where: { userId: params.userId },
    create: {
      userId: params.userId,
      status,
      dateOfBirth: params.dateOfBirth,
      addressLine1: params.addressLine1,
      addressLine2: params.addressLine2,
      city: params.city,
      postcode: params.postcode,
      country: params.country ?? 'GB',
      nationality: params.nationality,
      documentType: params.documentType,
      documentNumber: params.documentNumber,
      wallesterKycId: result.id,
      rejectionReason: result.reason,
      submittedAt: new Date(),
      verifiedAt: status === 'VERIFIED' ? new Date() : null,
    },
    update: {
      status,
      dateOfBirth: params.dateOfBirth,
      addressLine1: params.addressLine1,
      addressLine2: params.addressLine2,
      city: params.city,
      postcode: params.postcode,
      country: params.country ?? 'GB',
      nationality: params.nationality,
      documentType: params.documentType,
      documentNumber: params.documentNumber,
      wallesterKycId: result.id,
      rejectionReason: result.reason,
      submittedAt: new Date(),
      verifiedAt: status === 'VERIFIED' ? new Date() : null,
    },
  });
}

/** Re-sync status from the provider (e.g. after a manual review or webhook). */
export async function refreshKyc(userId: string) {
  const kyc = await prisma.kycProfile.findUnique({ where: { userId } });
  if (!kyc?.wallesterKycId) return kyc;
  const status = (await wallester.getKycStatus(kyc.wallesterKycId)) as KycStatus;
  return prisma.kycProfile.update({
    where: { userId },
    data: { status, verifiedAt: status === 'VERIFIED' ? new Date() : kyc.verifiedAt },
  });
}
