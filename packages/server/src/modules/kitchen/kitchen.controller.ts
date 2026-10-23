import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  type KitchenSettings,
  type KitchenTicket,
  dismissTicketSchema,
  idSchema,
  listTicketsQuerySchema,
  orderKitchenPrioritySchema,
  ticketItemDoneSchema,
  ticketPriorityRequestSchema,
  transitionTicketSchema,
} from '@pos/validation';
import { Feature } from '@pos/shared-types';
import type { z } from 'zod';
import { CurrentPrincipal, type Principal, RequirePermissions } from '../../common/auth/decorators';
import { RequireFeature } from '../../common/auth/require-feature';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { KitchenService } from './kitchen.service';

const id = new ZodValidationPipe(idSchema);

/** The kitchen display and kitchen priorities: only where the KDS module is on (ADR 0018). */
@RequireFeature(Feature.KDS)
@Controller('locations/:locationId')
export class KitchenController {
  constructor(private readonly kitchen: KitchenService) {}

  /** Stations and age thresholds for the kitchen screen. */
  @RequirePermissions(['kitchen.view'])
  @Get('kitchen/settings')
  settings(@Param('locationId', id) locationId: string): Promise<KitchenSettings> {
    return this.kitchen.settings(locationId);
  }

  @RequirePermissions(['kitchen.view'])
  @Get('kitchen/tickets')
  list(
    @Param('locationId', id) locationId: string,
    @Query(new ZodValidationPipe(listTicketsQuerySchema))
    query: z.output<typeof listTicketsQuerySchema>,
  ): Promise<KitchenTicket[]> {
    return this.kitchen.list(locationId, query);
  }

  @RequirePermissions(['kitchen.view'])
  @Get('kitchen/tickets/:ticketId')
  get(
    @Param('locationId', id) locationId: string,
    @Param('ticketId', id) ticketId: string,
  ): Promise<KitchenTicket> {
    return this.kitchen.get(locationId, ticketId);
  }

  @RequirePermissions(['kitchen.update'])
  @Post('kitchen/tickets/:ticketId/transitions')
  @HttpCode(200)
  transition(
    @Param('locationId', id) locationId: string,
    @Param('ticketId', id) ticketId: string,
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(transitionTicketSchema))
    body: z.output<typeof transitionTicketSchema>,
  ): Promise<KitchenTicket> {
    return this.kitchen.transition(principal, locationId, ticketId, body);
  }

  @RequirePermissions(['kitchen.update'])
  @Post('kitchen/tickets/:ticketId/priority')
  @HttpCode(200)
  priority(
    @Param('locationId', id) locationId: string,
    @Param('ticketId', id) ticketId: string,
    @Body(new ZodValidationPipe(ticketPriorityRequestSchema))
    body: z.output<typeof ticketPriorityRequestSchema>,
  ): Promise<KitchenTicket> {
    return this.kitchen.setPriority(locationId, ticketId, body);
  }

  @RequirePermissions(['kitchen.update'])
  @Post('kitchen/tickets/:ticketId/items/:itemId/done')
  @HttpCode(200)
  itemDone(
    @Param('locationId', id) locationId: string,
    @Param('ticketId', id) ticketId: string,
    @Param('itemId', id) itemId: string,
    @Body(new ZodValidationPipe(ticketItemDoneSchema)) body: z.output<typeof ticketItemDoneSchema>,
  ): Promise<KitchenTicket> {
    return this.kitchen.setItemDone(locationId, ticketId, itemId, body);
  }

  @RequirePermissions(['kitchen.update'])
  @Post('kitchen/tickets/:ticketId/dismiss')
  @HttpCode(200)
  dismiss(
    @Param('locationId', id) locationId: string,
    @Param('ticketId', id) ticketId: string,
    @Body(new ZodValidationPipe(dismissTicketSchema)) body: z.output<typeof dismissTicketSchema>,
  ): Promise<KitchenTicket> {
    return this.kitchen.dismiss(locationId, ticketId, body);
  }

  /** POS: rush an order in every station it was sent to. */
  @RequirePermissions(['orders.update'])
  @Post('orders/:orderId/kitchen-priority')
  @HttpCode(200)
  orderPriority(
    @Param('locationId', id) locationId: string,
    @Param('orderId', id) orderId: string,
    @Body(new ZodValidationPipe(orderKitchenPrioritySchema))
    body: z.output<typeof orderKitchenPrioritySchema>,
  ): Promise<KitchenTicket[]> {
    return this.kitchen.setOrderPriority(locationId, orderId, body);
  }
}
