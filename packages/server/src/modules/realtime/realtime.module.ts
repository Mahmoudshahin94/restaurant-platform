import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeBus } from './realtime.bus';
import { RealtimeGateway } from './realtime.gateway';

@Global()
@Module({
  imports: [AuthModule],
  providers: [RealtimeBus, RealtimeGateway],
  exports: [RealtimeBus, RealtimeGateway],
})
export class RealtimeModule {}
