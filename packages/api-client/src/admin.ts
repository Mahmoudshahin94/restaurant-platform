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
  const tenant = (tid: string) => `${API}/tenants/${tid}`;
  const location = (lid: string) => `${API}/locations/${lid}`;
  const report =
    <T extends z.ZodType>(name: string, schema: T) =>
    (tid: string, q: ReportQuery) =>
      http.request('GET', `${tenant(tid)}/reports/${name}`, {
        query: reportQuery(q),
        schema,
      });
  return {
    dashboard: (tid: string) =>
      http.request('GET', `${tenant(tid)}/dashboard`, { schema: dashboardSchema }),

    users: {
      list: (tid: string) =>
        http.request('GET', `${tenant(tid)}/users`, { schema: z.array(staffUserSchema) }),
      create: (tid: string, body: CreateUserRequest) =>
        http.request('POST', `${tenant(tid)}/users`, { body, schema: staffUserSchema }),
      update: (tid: string, userId: string, body: UpdateUserRequest) =>
        http.request('PATCH', `${tenant(tid)}/users/${userId}`, {
          body,
          schema: staffUserSchema,
        }),
      setRoles: (tid: string, userId: string, roles: RoleAssignmentInput[]) =>
        http.request('PUT', `${tenant(tid)}/users/${userId}/roles`, {
          body: { roles },
          schema: staffUserSchema,
        }),
      resetPassword: (tid: string, userId: string, password: string) =>
        http.request('POST', `${tenant(tid)}/users/${userId}/password`, {
          body: { password },
        }),
    },
    roles: {
      list: (tid: string) =>
        http.request('GET', `${tenant(tid)}/roles`, { schema: z.array(roleSchema) }),
      create: (tid: string, body: CreateRoleRequest) =>
        http.request('POST', `${tenant(tid)}/roles`, { body, schema: roleSchema }),
      update: (tid: string, roleId: string, body: UpdateRoleRequest) =>
        http.request('PATCH', `${tenant(tid)}/roles/${roleId}`, { body, schema: roleSchema }),
      remove: (tid: string, roleId: string) =>
        http.request('DELETE', `${tenant(tid)}/roles/${roleId}`),
    },
    employees: {
      list: (tid: string) =>
        http.request('GET', `${tenant(tid)}/employees`, { schema: z.array(employeeSchema) }),
      create: (tid: string, body: CreateEmployeeRequest) =>
        http.request('POST', `${tenant(tid)}/employees`, { body, schema: employeeSchema }),
      update: (tid: string, employeeId: string, body: UpdateEmployeeRequest) =>
        http.request('PATCH', `${tenant(tid)}/employees/${employeeId}`, {
          body,
          schema: employeeSchema,
        }),
      setPin: (tid: string, employeeId: string, pin: string) =>
        http.request('PUT', `${tenant(tid)}/employees/${employeeId}/pin`, {
          body: { pin },
          schema: employeeSchema,
        }),
    },

    paymentMethods: {
      /** Including archived ones (the POS list omits them). */
      list: (tid: string) =>
        http.request('GET', `${tenant(tid)}/payment-methods/all`, {
          schema: z.array(paymentMethodAdminSchema),
        }),
      create: (tid: string, body: CreatePaymentMethodRequest) =>
        http.request('POST', `${tenant(tid)}/payment-methods`, {
          body,
          schema: paymentMethodAdminSchema,
        }),
      update: (tid: string, id: string, body: UpdatePaymentMethodRequest) =>
        http.request('PATCH', `${tenant(tid)}/payment-methods/${id}`, {
          body,
          schema: paymentMethodAdminSchema,
        }),
      archive: (tid: string, id: string) =>
        http.request('POST', `${tenant(tid)}/payment-methods/${id}/archive`, {
          schema: paymentMethodAdminSchema,
        }),
      restore: (tid: string, id: string) =>
        http.request('POST', `${tenant(tid)}/payment-methods/${id}/restore`, {
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
      tid: string,
      q: Omit<OrderSearchQuery, 'status' | 'channel' | 'paymentStatus'> & {
        status?: string[];
        channel?: string[];
        paymentStatus?: string[];
      } = {},
    ) =>
      http.request('GET', `${tenant(tid)}/orders`, {
        query: {
          ...(q as Query),
          status: list(q.status),
          channel: list(q.channel),
          paymentStatus: list(q.paymentStatus),
        },
        schema: orderSummaryPageSchema,
      }),
    customers: (tid: string, q: CustomerQuery = {}) =>
      http.request('GET', `${tenant(tid)}/customers`, {
        query: q as Query,
        schema: customerPageSchema,
      }),
    customer: (tid: string, key: string) =>
      http.request('GET', `${tenant(tid)}/customers/${key}`, { schema: customerDetailSchema }),
    payments: (tid: string, q: PaymentSearchQuery = {}) =>
      http.request('GET', `${tenant(tid)}/payments`, {
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

    auditLogs: (tid: string, q: AuditLogQuery = {}) =>
      http.request('GET', `${tenant(tid)}/audit-logs`, {
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
