import { Module } from '@nestjs/common';
import { TerminalsController } from './terminals.controller';
import { TerminalsService } from './terminals.service';

/**
 * Terminals paired with a location hub (ADR 0022). **Hub only**: a terminal's credential is issued
 * and checked by its hub, which serves it on the location's network; the cloud only lists them.
 */
@Module({
  controllers: [TerminalsController],
  providers: [TerminalsService],
})
export class TerminalsModule {}
