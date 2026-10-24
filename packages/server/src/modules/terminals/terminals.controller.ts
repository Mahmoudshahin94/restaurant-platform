import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { TERMINAL_DEVICE_TYPES } from '@pos/shared-types';
import { type PairedTerminal, type Terminal, pairTerminalSchema } from '@pos/validation';
import type { z } from 'zod';
import { Public } from '../../common/auth/decorators';
import {
  type AuthenticatedTerminal,
  CurrentTerminal,
  DeviceRoute,
} from '../../common/auth/device-route';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { TerminalsService } from './terminals.service';

/** Terminals of the location hub (ADR 0022): pairing, and who a credential belongs to. */
@Controller('terminals')
export class TerminalsController {
  constructor(private readonly terminals: TerminalsService) {}

  /**
   * Pairs a terminal with the code the admin showed. Public: the code is the credential, single
   * use, short-lived and rate-limited like a sign-in. Returns the device credential once.
   */
  @Public()
  @Post('pair')
  @HttpCode(200)
  pair(
    @Body(new ZodValidationPipe(pairTerminalSchema)) body: z.output<typeof pairTerminalSchema>,
  ): Promise<PairedTerminal> {
    return this.terminals.pair(body.code);
  }

  /** The calling terminal: whether its credential still works (and its last contact). */
  @DeviceRoute(...TERMINAL_DEVICE_TYPES)
  @Get('me')
  me(@CurrentTerminal() terminal: AuthenticatedTerminal): Terminal {
    return {
      id: terminal.id,
      tenantId: terminal.tenantId,
      locationId: terminal.locationId,
      name: terminal.name,
      type: terminal.type,
    };
  }
}
