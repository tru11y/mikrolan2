import 'reflect-metadata';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { VouchersController } from './vouchers.controller';
import { VouchersGlobalController } from './vouchers-global.controller';

// Non-regression: endpoints that used to be gated only by JwtAuthGuard
// now carry an explicit @Roles(MEMBER) → OWNER/ADMIN/MEMBER/SUPER_ADMIN
// pass (hierarchy / omnipotence) and TICKET_VERIFIER is refused.
describe('voucher endpoints — @Roles hardening (lot 2)', () => {
  const cases: Array<[string, Function, string]> = [
    ['global verify', VouchersGlobalController.prototype.verify, 'verify'],
    ['list', VouchersController.prototype.list, 'list'],
    ['batches', VouchersController.prototype.batches, 'batches'],
    ['lookup', VouchersController.prototype.lookup, 'lookup'],
  ];

  it.each(cases)('%s requires MEMBER (TICKET_VERIFIER refused)', (_label, handler) => {
    const roles = Reflect.getMetadata(ROLES_KEY, handler) as
      | UserRole[]
      | undefined;
    expect(roles).toBeDefined();
    expect(roles).toContain(UserRole.MEMBER);
    expect(roles).not.toContain(UserRole.TICKET_VERIFIER);
  });

  // Already-restricted admin endpoints: TICKET_VERIFIER is refused by
  // RolesGuard's disjoint branch (required=[ADMIN] does not include
  // TICKET_VERIFIER). Covered by roles.guard.spec.ts; nothing to add here.
});
