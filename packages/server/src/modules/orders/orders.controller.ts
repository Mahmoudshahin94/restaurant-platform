import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import {
  type Order,
  createOrderSchema,
  idSchema,
  listOrdersQuerySchema,
  transitionOrderSchema,
  updateOrderSchema,
} from '@pos/validation';
import type { FastifyReply } from 'fastify';
import type { z } from 'zod';
import { CurrentPrincipal, type Principal, RequirePermissions } from '../../common/auth/decorators';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { OrdersService } from './orders.service';

const id = new ZodValidationPipe(idSchema);

@Controller('locations/:locationId/orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /** 201 when created, 200 when the same order id was already processed (idempotent replay). */
  @RequirePermissions(['orders.create'])
  @Post()
  async create(
    @Param('locationId', id) locationId: string,
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(createOrderSchema)) body: z.output<typeof createOrderSchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Order> {
    const { order, created } = await this.orders.create(principal, locationId, body);
    void reply.status(created ? 201 : 200);
    return order;
  }

  @RequirePermissions(['orders.view'])
  @Get()
  list(
    @Param('locationId', id) locationId: string,
    @Query(new ZodValidationPipe(listOrdersQuerySchema))
    query: z.output<typeof listOrdersQuerySchema>,
  ): Promise<Order[]> {
    return this.orders.list(locationId, query);
  }

  @RequirePermissions(['orders.view'])
  @Get(':orderId')
  get(
    @Param('locationId', id) locationId: string,
    @Param('orderId', id) orderId: string,
  ): Promise<Order> {
    return this.orders.get(locationId, orderId);
  }

  @RequirePermissions(['orders.update'])
  @Put(':orderId')
  update(
    @Param('locationId', id) locationId: string,
    @Param('orderId', id) orderId: string,
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(updateOrderSchema)) body: z.output<typeof updateOrderSchema>,
  ): Promise<Order> {
    return this.orders.update(principal, locationId, orderId, body);
  }

  /** The specific permission (update/cancel/refund) is checked per transition by the service. */
  @RequirePermissions(['orders.view'])
  @Post(':orderId/transitions')
  @HttpCode(200)
  transition(
    @Param('locationId', id) locationId: string,
    @Param('orderId', id) orderId: string,
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(transitionOrderSchema))
    body: z.output<typeof transitionOrderSchema>,
  ): Promise<Order> {
    return this.orders.transition(principal, locationId, orderId, body);
  }
}
