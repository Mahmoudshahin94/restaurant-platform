import { Body, Controller, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import { DeviceType, Feature } from '@pos/shared-types';
import {
  type KioskAttendant,
  type KioskContext,
  type KioskPaymentOutcome,
  type Order,
  type PublishedMenu,
  createKioskOrderSchema,
  idSchema,
  kioskAttendantRequestSchema,
  kioskPaymentSchema,
} from '@pos/validation';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import {
  type AuthenticatedTerminal,
  CurrentTerminal,
  DeviceRoute,
} from '../../common/auth/device-route';
import { RequireFeature } from '../../common/auth/require-feature';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { KioskService } from './kiosk.service';

const id = new ZodValidationPipe(idSchema);

/**
 * What a self-service kiosk may do at its hub (ADR 0022), and nothing else: read its context and
 * the menu, place and pay its own orders, and let staff out of the customer screens. Every route
 * needs a kiosk's device credential; ordering needs the SELF_CHECKOUT module, resolved for the
 * location and the kiosk itself.
 */
@DeviceRoute(DeviceType.KIOSK)
@Controller()
export class KioskController {
  constructor(private readonly kiosk: KioskService) {}

  /** Who and where the kiosk is, the tenant's branding for the kiosk, money, languages, modules. */
  @Get('kiosk/context')
  context(@CurrentTerminal() terminal: AuthenticatedTerminal): Promise<KioskContext> {
    return this.kiosk.context(terminal);
  }

  /** The location's published menu (304 when the kiosk's copy is current). */
  @RequireFeature(Feature.SELF_CHECKOUT)
  @Get('locations/:locationId/kiosk/menu')
  async menu(
    @Param('locationId', id) _locationId: string,
    @CurrentTerminal() terminal: AuthenticatedTerminal,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PublishedMenu | undefined> {
    const menu = await this.kiosk.menu(terminal);
    const etag = `"${menu.version}"`;
    void reply.header('etag', etag).header('cache-control', 'private, no-cache');
    if (request.headers['if-none-match'] === etag) {
      void reply.status(304);
      return undefined;
    }
    return menu;
  }

  /** 201 when created, 200 when the same order id was already placed (idempotent replay). */
  @RequireFeature(Feature.SELF_CHECKOUT)
  @Post('locations/:locationId/kiosk/orders')
  async create(
    @Param('locationId', id) _locationId: string,
    @CurrentTerminal() terminal: AuthenticatedTerminal,
    @Body(new ZodValidationPipe(createKioskOrderSchema))
    body: z.output<typeof createKioskOrderSchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Order> {
    const { order, created } = await this.kiosk.createOrder(terminal, body);
    void reply.status(created ? 201 : 200);
    return order;
  }

  /** The payment intent: what is due, charged at the kiosk's own card terminal. */
  @RequireFeature(Feature.SELF_CHECKOUT)
  @Post('locations/:locationId/kiosk/orders/:orderId/payments')
  @HttpCode(200)
  pay(
    @Param('locationId', id) _locationId: string,
    @Param('orderId', id) orderId: string,
    @CurrentTerminal() terminal: AuthenticatedTerminal,
    @Body(new ZodValidationPipe(kioskPaymentSchema)) body: z.output<typeof kioskPaymentSchema>,
  ): Promise<KioskPaymentOutcome> {
    return this.kiosk.pay(terminal, orderId, body);
  }

  /** The customer walked away before paying. */
  @RequireFeature(Feature.SELF_CHECKOUT)
  @Post('locations/:locationId/kiosk/orders/:orderId/cancel')
  @HttpCode(200)
  cancel(
    @Param('locationId', id) _locationId: string,
    @Param('orderId', id) orderId: string,
    @CurrentTerminal() terminal: AuthenticatedTerminal,
  ): Promise<Order> {
    return this.kiosk.cancel(terminal, orderId);
  }

  /** Staff leaving the customer screens (employee code + PIN, `kiosk.attend`). */
  @Post('kiosk/attendant')
  @HttpCode(200)
  attendant(
    @CurrentTerminal() terminal: AuthenticatedTerminal,
    @Body(new ZodValidationPipe(kioskAttendantRequestSchema))
    body: z.output<typeof kioskAttendantRequestSchema>,
  ): Promise<KioskAttendant> {
    return this.kiosk.attendant(terminal, body.employeeCode, body.pin);
  }
}
