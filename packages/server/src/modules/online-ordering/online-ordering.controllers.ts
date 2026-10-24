import { Body, Controller, Get, Headers, Param, Post, Put, Req, Res } from '@nestjs/common';
import {
  type OnlineOrderingOverview,
  type PublicLocation,
  type PublicOrder,
  type PublicSite,
  type PublishedMenu,
  type WebOrderCreated,
  createWebOrderSchema,
  idSchema,
  updateOnlineOrderingSchema,
} from '@pos/validation';
import { Feature } from '@pos/shared-types';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { RequirePermissions } from '../../common/auth/decorators';
import { CurrentSite, HostRoute, type SiteHost } from '../../common/auth/host-route';
import { RequireFeature } from '../../common/auth/require-feature';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { sendTenantFile } from '../files/file-response';
import { SiteLocations } from './site-locations';
import { StorefrontService } from './storefront.service';
import { WebOrdersService } from './web-orders.service';

const id = new ZodValidationPipe(idSchema);

/**
 * The tenant website's read API (ADR 0023): no account, no token, rate limited like every route.
 * The tenant is the one whose verified domain the request's host names (`@HostRoute`); nothing
 * the browser sends names it. A location must be that tenant's.
 */
@RequireFeature(Feature.ONLINE_ORDERING)
@HostRoute()
@Controller('public/site')
export class SiteController {
  constructor(private readonly storefront: StorefrontService) {}

  /**
   * The tenant, its locations and its published website. With a valid preview token of the same
   * tenant (`x-website-preview`, from the admin) the draft instead, never cached.
   */
  @Get()
  site(
    @CurrentSite() site: SiteHost,
    @Headers('x-website-preview') preview: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PublicSite> {
    void reply.header('cache-control', preview ? 'no-store' : 'public, no-cache');
    return this.storefront.site(site.tenantId, site.domain, preview);
  }

  /** A logo or favicon of the tenant's branding, or a picture of its website's sections. */
  @Get('files/:fileId')
  async file(
    @CurrentSite() site: SiteHost,
    @Param('fileId', id) fileId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer> {
    const { file, bytes } = await this.storefront.siteFile(site.tenantId, fileId);
    return sendTenantFile(reply, file, bytes, 'public');
  }

  @Get('locations/:locationId')
  location(@Param('locationId', id) locationId: string): Promise<PublicLocation> {
    return this.storefront.location(locationId);
  }

  /** The published menu; `If-None-Match` answers `304` when it did not change. */
  @Get('locations/:locationId/menu')
  async menu(
    @Param('locationId', id) locationId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PublishedMenu | undefined> {
    const menu = await this.storefront.menu(locationId);
    const etag = `"${menu.version}"`;
    void reply.header('etag', etag).header('cache-control', 'public, no-cache');
    if (request.headers['if-none-match'] === etag) {
      void reply.status(304);
      return undefined;
    }
    return menu;
  }
}

/**
 * Website orders: placed by guests, followed with the tracking token (ADR 0013), on the tenant's
 * own website only (ADR 0023): the order's location, or the tracked order, must be the host's
 * tenant's, otherwise it is not found.
 */
@RequireFeature(Feature.ONLINE_ORDERING)
@HostRoute()
@Controller('orders')
export class WebOrdersController {
  constructor(
    private readonly orders: WebOrdersService,
    private readonly locations: SiteLocations,
  ) {}

  /** 201 when created, 200 for a resend of the same order id (idempotent). */
  @Post()
  async create(
    @CurrentSite() site: SiteHost,
    @Body(new ZodValidationPipe(createWebOrderSchema)) body: z.output<typeof createWebOrderSchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<WebOrderCreated> {
    await this.locations.assert(site.tenantId, body.locationId);
    const { result, created } = await this.orders.create(body);
    void reply.status(created ? 201 : 200).header('cache-control', 'no-store');
    return result;
  }

  /** The token travels in a header (`x-tracking-token`), never in the URL, so it stays out of logs. */
  @Get('track')
  track(
    @CurrentSite() site: SiteHost,
    @Headers('x-tracking-token') token: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PublicOrder> {
    void reply.header('cache-control', 'no-store');
    return this.orders.track(token, (locationId) =>
      this.locations.assert(site.tenantId, locationId),
    );
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
