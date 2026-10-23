import { Body, Controller, Get, Headers, Param, Post, Put, Req, Res } from '@nestjs/common';
import {
  type OnlineOrderingOverview,
  type PublicLocation,
  type PublicOrder,
  type PublicTenant,
  type PublishedMenu,
  type WebOrderCreated,
  createWebOrderSchema,
  idSchema,
  updateOnlineOrderingSchema,
} from '@pos/validation';
import { Feature } from '@pos/shared-types';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Public, RequirePermissions } from '../../common/auth/decorators';
import { RequireFeature } from '../../common/auth/require-feature';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { PublicTenantResolver } from './public-tenant.resolver';
import { StorefrontService } from './storefront.service';
import { WebOrdersService } from './web-orders.service';

const id = new ZodValidationPipe(idSchema);
const slug = new ZodValidationPipe(
  z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(60),
);

/**
 * The customer website's read API: no account, no token, rate limited like every route. Its
 * tenant is known only once the route resolves it, so `PublicTenantResolver` checks the module.
 */
@RequireFeature(Feature.ONLINE_ORDERING)
@Public()
@Controller('public')
export class StorefrontController {
  constructor(
    private readonly storefront: StorefrontService,
    private readonly tenants: PublicTenantResolver,
  ) {}

  @Get('tenants/:slug')
  async tenant(@Param('slug', slug) tenantSlug: string): Promise<PublicTenant> {
    const tenantId = await this.tenants.bySlug(tenantSlug);
    return TenantContext.runInTenant(tenantId, () => this.storefront.tenant(tenantSlug));
  }

  @Get('locations/:locationId')
  location(@Param('locationId', id) locationId: string): Promise<PublicLocation> {
    return this.tenants.inLocationTenant(locationId, () => this.storefront.location(locationId));
  }

  /** The published menu; `If-None-Match` answers `304` when it did not change. */
  @Get('locations/:locationId/menu')
  async menu(
    @Param('locationId', id) locationId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PublishedMenu | undefined> {
    const menu = await this.tenants.inLocationTenant(locationId, () =>
      this.storefront.menu(locationId),
    );
    const etag = `"${menu.version}"`;
    void reply.header('etag', etag).header('cache-control', 'public, no-cache');
    if (request.headers['if-none-match'] === etag) {
      void reply.status(304);
      return undefined;
    }
    return menu;
  }
}

/** Website orders: placed by guests, followed with the tracking token (ADR 0013). */
@RequireFeature(Feature.ONLINE_ORDERING)
@Public()
@Controller('orders')
export class WebOrdersController {
  constructor(
    private readonly orders: WebOrdersService,
    private readonly tenants: PublicTenantResolver,
  ) {}

  /** 201 when created, 200 for a resend of the same order id (idempotent). */
  @Post()
  async create(
    @Body(new ZodValidationPipe(createWebOrderSchema)) body: z.output<typeof createWebOrderSchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<WebOrderCreated> {
    const { result, created } = await this.tenants.inLocationTenant(body.locationId, () =>
      this.orders.create(body),
    );
    void reply.status(created ? 201 : 200).header('cache-control', 'no-store');
    return result;
  }

  /** The token travels in a header (`x-tracking-token`), never in the URL, so it stays out of logs. */
  @Get('track')
  track(
    @Headers('x-tracking-token') token: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PublicOrder> {
    void reply.header('cache-control', 'no-store');
    return this.orders.track(token);
  }
}

/** The tenant's online-ordering switch, hours and options (admin, cloud only). */
@RequireFeature(Feature.ONLINE_ORDERING)
@Controller('locations/:locationId/online-ordering')
export class OnlineOrderingSettingsController {
  constructor(private readonly storefront: StorefrontService) {}

  @RequirePermissions(['locations.view'])
  @Get()
  get(@Param('locationId', id) locationId: string): Promise<OnlineOrderingOverview> {
    return this.storefront.settings(locationId);
  }

  @RequirePermissions(['online_ordering.manage'])
  @Put()
  update(
    @Param('locationId', id) locationId: string,
    @Body(new ZodValidationPipe(updateOnlineOrderingSchema))
    body: z.output<typeof updateOnlineOrderingSchema>,
  ): Promise<OnlineOrderingOverview> {
    return this.storefront.updateSettings(locationId, body);
  }
}
