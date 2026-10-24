import { Module } from '@nestjs/common';
import { WireGuardService } from '../../common/wireguard/wireguard.service';
import { ComplianceCron } from './compliance.cron';
import { ComplianceRetentionService } from './compliance-retention.service';
import { PeerRevocationService } from './peer-revocation.service';
import { RemoteAccessAuthorizationController } from './remote-access-authorization.controller';
import { RemoteAccessAuthorizationService } from './remote-access-authorization.service';

@Module({
  controllers: [RemoteAccessAuthorizationController],
  providers: [
    ComplianceCron,
    ComplianceRetentionService,
    PeerRevocationService,
    RemoteAccessAuthorizationService,
    WireGuardService,
  ],
})
export class ComplianceModule {}
