import { HttpStatus } from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCode } from '../../common/error-codes';

export function saspayManagedError(): BusinessException {
  return new BusinessException(
    HttpStatus.CONFLICT,
    ErrorCode.SASPAY_INVOICE_MANAGED_BY_WEBHOOK,
    'Cette facture SasPay est gérée automatiquement par le webhook de paiement.',
  );
}
