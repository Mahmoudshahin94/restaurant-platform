import {
  type AuditLogQuery,
  type ChangeTenantStatusRequest,
  type DeviceVersionsQuery,
  type PlatformAuditQuery,
  type PlatformErrorsQuery,
  type PlatformLoginRequest,
  type PlatformTenantsQuery,
  type ProvisionTenantRequest,
  type PublishReleaseRequest,
  type SetEntitlementsRequest,
  type SetTenantRolloutRequest,
  type SupportExecuteRequest,
  type SupportFindQuery,
  type SupportRequest,
  type UpdateReleaseRequest,
  deviceVersionsSchema,
  healthBoardSchema,
  locationSchema,
  paymentProvidersOverviewSchema,
  platformAuditPageSchema,
  platformDeviceSchema,
  platformErrorEventSchema,
  platformModuleSchema,
  platformTenantAuditPageSchema,
  platformTenantDetailSchema,
  platformTenantPageSchema,
  platformTenantUserSchema,
  platformTokenResponseSchema,
  platformUserSchema,
  provisionedTenantSchema,
  releaseSchema,
  releasesOverviewSchema,
  supportExecutionSchema,
  supportFindResultSchema,
  supportOperationSchema,
  supportPreviewSchema,
  tenantBrandingSchema,
  tenantDomainSchema,
  tenantHealthSchema,
  tenantRolloutSchema,
} from '@pos/validation';
import { z } from 'zod';
import { HttpClient, type HttpClientOptions } from './http';

const API = '/api/v1/platform';
type Query = Record<string, string | number | boolean | undefined>;

/**
 * The platform admin's API (ADR 0025), for MADAR's operators. A separate client from the tenant
 * apps' (`createApiClient`): platform tokens are refused by every tenant route and the other way
 * round, and the refresh cookie is scoped to `/api/v1/platform/auth`.
 */
export function createPlatformApiClient(options: HttpClientOptions) {
  const http = new HttpClient(options);
  const tenant = (tid: string) => `${API}/tenants/${tid}`;

  return {
    http,
    auth: {
      login: (body: PlatformLoginRequest) =>
        http.request('POST', `${API}/auth/login`, {
          body,
          schema: platformTokenResponseSchema,
          noRetry: true,
        }),
      /** The httpOnly cookie carries the refresh token. */
      refresh: () =>
        http.request('POST', `${API}/auth/refresh`, {
          body: {},
          schema: platformTokenResponseSchema,
          noRetry: true,
        }),
      logout: () => http.request('POST', `${API}/auth/logout`, { body: {}, noRetry: true }),
      me: () => http.request('GET', `${API}/auth/me`, { schema: platformUserSchema }),
    },

    tenants: {
      list: (query: PlatformTenantsQuery = {}) =>
        http.request('GET', `${API}/tenants`, {
          query: query as Query,
          schema: platformTenantPageSchema,
        }),
      /** The owner's temporary password is in this answer only. */
      provision: (body: ProvisionTenantRequest) =>
        http.request('POST', `${API}/tenants`, { body, schema: provisionedTenantSchema }),
      get: (tid: string) =>
        http.request('GET', tenant(tid), { schema: platformTenantDetailSchema }),
      setStatus: (tid: string, body: ChangeTenantStatusRequest) =>
        http.request('POST', `${tenant(tid)}/status`, {
          body,
          schema: platformTenantDetailSchema,
        }),
      locations: (tid: string) =>
        http.request('GET', `${tenant(tid)}/locations`, { schema: z.array(locationSchema) }),
      users: (tid: string) =>
        http.request('GET', `${tenant(tid)}/users`, {
          schema: z.array(platformTenantUserSchema),
        }),
      devices: (tid: string) =>
        http.request('GET', `${tenant(tid)}/devices`, { schema: z.array(platformDeviceSchema) }),
      modules: (tid: string) =>
        http.request('GET', `${tenant(tid)}/modules`, { schema: z.array(platformModuleSchema) }),
      setEntitlements: (tid: string, body: SetEntitlementsRequest) =>
        http.request('PUT', `${tenant(tid)}/entitlements`, {
          body,
          schema: z.array(platformModuleSchema),
        }),
      branding: (tid: string) =>
        http.request('GET', `${tenant(tid)}/branding`, { schema: tenantBrandingSchema }),
      domains: (tid: string) =>
        http.request('GET', `${tenant(tid)}/domains`, { schema: z.array(tenantDomainSchema) }),
      verifyDomain: (tid: string, domainId: string) =>
        http.request('POST', `${tenant(tid)}/domains/${domainId}/verify`, {
          schema: tenantDomainSchema,
        }),
      /** Accounts with their secrets' status only, never the secrets. */
      paymentAccounts: (tid: string) =>
        http.request('GET', `${tenant(tid)}/payment-accounts`, {
          schema: paymentProvidersOverviewSchema,
        }),
      health: (tid: string) =>
        http.request('GET', `${tenant(tid)}/health`, { schema: tenantHealthSchema }),
      auditLogs: (tid: string, query: AuditLogQuery = {}) =>
        http.request('GET', `${tenant(tid)}/audit-logs`, {
          query: query as Query,
          schema: platformTenantAuditPageSchema,
        }),
    },

    health: {
      board: () => http.request('GET', `${API}/health`, { schema: healthBoardSchema }),
      errors: (query: PlatformErrorsQuery = {}) =>
        http.request('GET', `${API}/errors`, {
          query: query as Query,
          schema: z.array(platformErrorEventSchema),
        }),
    },

    auditLogs: (query: PlatformAuditQuery = {}) =>
      http.request('GET', `${API}/audit-logs`, {
        query: query as Query,
        schema: platformAuditPageSchema,
      }),

    support: {
      operations: () =>
        http.request('GET', `${API}/support/operations`, {
          schema: z.array(supportOperationSchema),
        }),
      find: (tid: string, query: SupportFindQuery) =>
        http.request('GET', `${tenant(tid)}/support/find`, {
          query,
          schema: supportFindResultSchema,
        }),
      /** Before and after, and the confirmation an execution needs. Changes nothing. */
      preview: (tid: string, body: SupportRequest) =>
        http.request('POST', `${tenant(tid)}/support/preview`, {
          body,
          schema: supportPreviewSchema,
        }),
      execute: (tid: string, body: SupportExecuteRequest) =>
        http.request('POST', `${tenant(tid)}/support/execute`, {
          body,
          schema: supportExecutionSchema,
        }),
    },

    /** Releases and rollout (ADR 0026). */
    releases: {
      overview: () => http.request('GET', `${API}/releases`, { schema: releasesOverviewSchema }),
      publish: (body: PublishReleaseRequest) =>
        http.request('POST', `${API}/releases`, { body, schema: releaseSchema }),
      update: (releaseId: string, body: UpdateReleaseRequest) =>
        http.request('PATCH', `${API}/releases/${releaseId}`, { body, schema: releaseSchema }),
      deviceVersions: (query: DeviceVersionsQuery = {}) =>
        http.request('GET', `${API}/device-versions`, {
          query,
          schema: deviceVersionsSchema,
        }),
      rollout: (tid: string) =>
        http.request('GET', `${tenant(tid)}/release-channel`, { schema: tenantRolloutSchema }),
      setRollout: (tid: string, body: SetTenantRolloutRequest) =>
        http.request('PUT', `${tenant(tid)}/release-channel`, {
          body,
          schema: tenantRolloutSchema,
        }),
    },
  };
}

export type PlatformApiClient = ReturnType<typeof createPlatformApiClient>;
