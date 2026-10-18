import {
  type AdminRefundRequest,
  type AuditLogQuery,
  type CreateCashRegisterRequest,
  type CreateEmployeeRequest,
  type CreatePaymentMethodRequest,
  type CreateRoleRequest,
  type CreateUserRequest,
  type CustomerQuery,
  type OrderSearchQuery,
  type PairDeviceRequest,
  type PaymentSearchQuery,
  type ReportQuery,
  type ResolveSyncIssueRequest,
  type RoleAssignmentInput,
  type SyncIssuesQuery,
  type UpdateCashRegisterRequest,
  type UpdateEmployeeRequest,
  type UpdatePaymentMethodRequest,
  type UpdateRoleRequest,
  type UpdateUserRequest,
  adminDeviceSchema,
  categoryReportSchema,
  channelReportSchema,
  dailySalesReportSchema,
  discountReportSchema,
  paymentReportSchema,
  prepTimeReportSchema,
  productReportSchema,
  shiftReportSchema,
  taxReportSchema,
  adminSyncIssueSchema,
  auditLogPageSchema,
  cashRegisterAdminSchema,
  customerDetailSchema,
  customerPageSchema,
  dashboardSchema,
  deviceSchema,
  employeeSchema,
  locationSyncStatusSchema,
  orderSummaryPageSchema,
  pairedDeviceSchema,
  paymentListItemSchema,
  paymentMethodAdminSchema,
  paymentPageSchema,
  roleSchema,
  staffUserSchema,
  syncIssueDetailSchema,
} from '@pos/validation';
import { z } from 'zod';
import type { HttpClient } from './http';

const API = '/api/v1';
type Query = Record<string, string | number | boolean | undefined>;

/** Joins list filters for the query string (`a,b`); omits empty ones. */
const list = (values?: readonly string[]) =>
  values && values.length > 0 ? values.join(',') : undefined;

/** Report filters for the query string. */
const reportQuery = (q: ReportQuery): Query => ({
  from: q.from,
  to: q.to,
  locationIds: list(q.locationIds),
  channels: list(q.channels),
});

/** The admin portal's cloud-only endpoints (Phases 8–9). */
export function adminApi(http: HttpClient) {
  const restaurant = (rid: string) => `${API}/restaurants/${rid}`;
  const location = (lid: string) => `${API}/locations/${lid}`;
  const report =
    <T extends z.ZodType>(name: string, schema: T) =>
    (rid: string, q: ReportQuery) =>
      http.request('GET', `${restaurant(rid)}/reports/${name}`, {
        query: reportQuery(q),
        schema,
      });
  return {
    dashboard: (rid: string) =>
      http.request('GET', `${restaurant(rid)}/dashboard`, { schema: dashboardSchema }),

    users: {
      list: (rid: string) =>
        http.request('GET', `${restaurant(rid)}/users`, { schema: z.array(staffUserSchema) }),
      create: (rid: string, body: CreateUserRequest) =>
        http.request('POST', `${restaurant(rid)}/users`, { body, schema: staffUserSchema }),
      update: (rid: string, userId: string, body: UpdateUserRequest) =>
        http.request('PATCH', `${restaurant(rid)}/users/${userId}`, {
          body,
          schema: staffUserSchema,
        }),
      setRoles: (rid: string, userId: string, roles: RoleAssignmentInput[]) =>
        http.request('PUT', `${restaurant(rid)}/users/${userId}/roles`, {
          body: { roles },
          schema: staffUserSchema,
        }),
      resetPassword: (rid: string, userId: string, password: string) =>
        http.request('POST', `${restaurant(rid)}/users/${userId}/password`, {
          body: { password },
        }),
    },
    roles: {
      list: (rid: string) =>
        http.request('GET', `${restaurant(rid)}/roles`, { schema: z.array(roleSchema) }),
      create: (rid: string, body: CreateRoleRequest) =>
        http.request('POST', `${restaurant(rid)}/roles`, { body, schema: roleSchema }),
      update: (rid: string, roleId: string, body: UpdateRoleRequest) =>
        http.request('PATCH', `${restaurant(rid)}/roles/${roleId}`, { body, schema: roleSchema }),
      remove: (rid: string, roleId: string) =>
        http.request('DELETE', `${restaurant(rid)}/roles/${roleId}`),
    },
    employees: {
      list: (rid: string) =>
        http.request('GET', `${restaurant(rid)}/employees`, { schema: z.array(employeeSchema) }),
      create: (rid: string, body: CreateEmployeeRequest) =>
        http.request('POST', `${restaurant(rid)}/employees`, { body, schema: employeeSchema }),
      update: (rid: string, employeeId: string, body: UpdateEmployeeRequest) =>
        http.request('PATCH', `${restaurant(rid)}/employees/${employeeId}`, {
          body,
          schema: employeeSchema,
        }),
      setPin: (rid: string, employeeId: string, pin: string) =>
        http.request('PUT', `${restaurant(rid)}/employees/${employeeId}/pin`, {
          body: { pin },
          schema: employeeSchema,
        }),
    },

    paymentMethods: {
      /** Including archived ones (the POS list omits them). */
      list: (rid: string) =>
        http.request('GET', `${restaurant(rid)}/payment-methods/all`, {
          schema: z.array(paymentMethodAdminSchema),
        }),
      create: (rid: string, body: CreatePaymentMethodRequest) =>
        http.request('POST', `${restaurant(rid)}/payment-methods`, {
          body,
          schema: paymentMethodAdminSchema,
        }),
      update: (rid: string, id: string, body: UpdatePaymentMethodRequest) =>
        http.request('PATCH', `${restaurant(rid)}/payment-methods/${id}`, {
          body,
          schema: paymentMethodAdminSchema,
        }),
      archive: (rid: string, id: string) =>
        http.request('POST', `${restaurant(rid)}/payment-methods/${id}/archive`, {
          schema: paymentMethodAdminSchema,
        }),
      restore: (rid: string, id: string) =>
        http.request('POST', `${restaurant(rid)}/payment-methods/${id}/restore`, {
          schema: paymentMethodAdminSchema,
        }),
    },
    cashRegisters: {
      list: (lid: string) =>
        http.request('GET', `${location(lid)}/cash-registers/all`, {
          schema: z.array(cashRegisterAdminSchema),
        }),
      create: (lid: string, body: CreateCashRegisterRequest) =>
        http.request('POST', `${location(lid)}/cash-registers`, {
          body,
          schema: cashRegisterAdminSchema,
        }),
      update: (lid: string, id: string, body: UpdateCashRegisterRequest) =>
        http.request('PATCH', `${location(lid)}/cash-registers/${id}`, {
          body,
          schema: cashRegisterAdminSchema,
        }),
      archive: (lid: string, id: string) =>
        http.request('POST', `${location(lid)}/cash-registers/${id}/archive`, {
          schema: cashRegisterAdminSchema,
        }),
      restore: (lid: string, id: string) =>
        http.request('POST', `${location(lid)}/cash-registers/${id}/restore`, {
          schema: cashRegisterAdminSchema,
        }),
    },

    orders: (
      rid: string,
      q: Omit<OrderSearchQuery, 'status' | 'channel' | 'paymentStatus'> & {
        status?: string[];
        channel?: string[];
        paymentStatus?: string[];
      } = {},
    ) =>
      http.request('GET', `${restaurant(rid)}/orders`, {
        query: {
          ...(q as Query),
          status: list(q.status),
          channel: list(q.channel),
          paymentStatus: list(q.paymentStatus),
        },
        schema: orderSummaryPageSchema,
      }),
    customers: (rid: string, q: CustomerQuery = {}) =>
      http.request('GET', `${restaurant(rid)}/customers`, {
        query: q as Query,
        schema: customerPageSchema,
      }),
    customer: (rid: string, key: string) =>
      http.request('GET', `${restaurant(rid)}/customers/${key}`, { schema: customerDetailSchema }),
    payments: (rid: string, q: PaymentSearchQuery = {}) =>
      http.request('GET', `${restaurant(rid)}/payments`, {
        query: q as Query,
        schema: paymentPageSchema,
      }),
    /** Online card charges only; idempotent on `body.id`. */
    refund: (lid: string, paymentId: string, body: AdminRefundRequest) =>
      http.request('POST', `${location(lid)}/payments/${paymentId}/refunds`, {
        body,
        schema: paymentListItemSchema,
      }),
    /** Reports (Phase 9): `reports.view`, over business dates. */
    reports: {
      dailySales: report('daily-sales', dailySalesReportSchema),
      channels: report('channels', channelReportSchema),
      payments: report('payments', paymentReportSchema),
      products: report('products', productReportSchema),
      categories: report('categories', categoryReportSchema),
      taxes: report('taxes', taxReportSchema),
      discounts: report('discounts', discountReportSchema),
      shifts: report('shifts', shiftReportSchema),
      prepTimes: report('prep-times', prepTimeReportSchema),
    },

    auditLogs: (rid: string, q: AuditLogQuery = {}) =>
      http.request('GET', `${restaurant(rid)}/audit-logs`, {
        query: q as Query,
        schema: auditLogPageSchema,
      }),

    devices: {
      list: (lid: string) =>
        http.request('GET', `${location(lid)}/devices`, { schema: z.array(adminDeviceSchema) }),
      pair: (lid: string, body: PairDeviceRequest) =>
        http.request('POST', `${location(lid)}/devices`, { body, schema: pairedDeviceSchema }),
      disable: (lid: string, deviceId: string) =>
        http.request('POST', `${location(lid)}/devices/${deviceId}/disable`, {
          schema: deviceSchema,
        }),
    },
    sync: {
      status: (lid: string) =>
        http.request('GET', `${location(lid)}/sync/status`, { schema: locationSyncStatusSchema }),
      issues: (lid: string, q: SyncIssuesQuery = {}) =>
        http.request('GET', `${location(lid)}/sync/issues`, {
          query: q,
          schema: z.array(adminSyncIssueSchema),
        }),
      issue: (lid: string, operationId: string) =>
        http.request('GET', `${location(lid)}/sync/issues/${operationId}`, {
          schema: syncIssueDetailSchema,
        }),
      resolve: (lid: string, operationId: string, body: ResolveSyncIssueRequest) =>
        http.request('POST', `${location(lid)}/sync/issues/${operationId}/resolve`, {
          body,
          schema: syncIssueDetailSchema,
        }),
    },
  };
}
