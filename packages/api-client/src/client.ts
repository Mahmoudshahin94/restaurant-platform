import {
  type ListProductsQuery,
  type SetLocationProductRequest,
  type CreateOrderRequest,
  type CreateTableRequest,
  type CreateTableSectionRequest,
  type TransitionOrderRequest,
  type UpdateOrderRequest,
  type UpdateTableRequest,
  createDiscountSchema,
  createTaxSchema,
  discountSchema,
  orderSchema,
  tableSectionSchema,
  taxSchema,
  updateDiscountSchema,
  updateTaxSchema,
  categorySchema,
  createCategorySchema,
  createKitchenStationSchema,
  createModifierGroupSchema,
  createProductSchema,
  updateCategorySchema,
  updateKitchenStationSchema,
  updateModifierGroupSchema,
  updateProductSchema,
  kitchenStationSchema,
  locationProductSettingSchema,
  modifierGroupSchema,
  productSchema,
  publishedMenuSchema,
  type LoginRequest,
  type UpdateLocationRequest,
  type UpdateRestaurantRequest,
  authUserSchema,
  locationSchema,
  restaurantSchema,
  tokenResponseSchema,
  type CreateLocationRequest,
} from '@pos/validation';
import type { OrderStatus } from '@pos/shared-types';
import { z } from 'zod';
import { HttpClient, type HttpClientOptions } from './http';

const API = '/api/v1';

export interface OrderListFilter {
  status?: OrderStatus[];
  /** Only orders that are not completed, cancelled or refunded. */
  open?: boolean;
  /** YYYY-MM-DD in the location's timezone. */
  businessDate?: string;
  tableId?: string;
  limit?: number;
}

/** Typed access to the cloud API. Every method's request and response types come from @pos/validation. */
export function createApiClient(options: HttpClientOptions) {
  const http = new HttpClient(options);

  return {
    http,
    auth: {
      login: (body: LoginRequest) =>
        http.request('POST', `${API}/auth/login`, {
          body,
          schema: tokenResponseSchema,
          noRetry: true,
        }),
      /** Web clients rely on the httpOnly cookie; native clients pass their stored token. */
      refresh: (refreshToken?: string) =>
        http.request('POST', `${API}/auth/refresh`, {
          body: refreshToken ? { refreshToken } : {},
          schema: tokenResponseSchema,
          noRetry: true,
        }),
      logout: (refreshToken?: string) =>
        http.request('POST', `${API}/auth/logout`, {
          body: refreshToken ? { refreshToken } : {},
          noRetry: true,
        }),
      me: () => http.request('GET', `${API}/auth/me`, { schema: authUserSchema }),
    },
    restaurants: {
      get: (restaurantId: string) =>
        http.request('GET', `${API}/restaurants/${restaurantId}`, { schema: restaurantSchema }),
      update: (restaurantId: string, body: UpdateRestaurantRequest) =>
        http.request('PATCH', `${API}/restaurants/${restaurantId}`, {
          body,
          schema: restaurantSchema,
        }),
    },
    locations: {
      list: (restaurantId: string) =>
        http.request('GET', `${API}/restaurants/${restaurantId}/locations`, {
          schema: z.array(locationSchema),
        }),
      get: (locationId: string) =>
        http.request('GET', `${API}/locations/${locationId}`, { schema: locationSchema }),
      create: (restaurantId: string, body: CreateLocationRequest) =>
        http.request('POST', `${API}/restaurants/${restaurantId}/locations`, {
          body,
          schema: locationSchema,
        }),
      update: (locationId: string, body: UpdateLocationRequest) =>
        http.request('PATCH', `${API}/locations/${locationId}`, { body, schema: locationSchema }),
      /** Resolved menu; pass the previous version to get `undefined` (304) when unchanged. */
      menu: (locationId: string, previousVersion?: string) =>
        http.request('GET', `${API}/locations/${locationId}/menu`, {
          schema: publishedMenuSchema,
          ...(previousVersion ? { headers: { 'if-none-match': `"${previousVersion}"` } } : {}),
        }),
      productSettings: (locationId: string) =>
        http.request('GET', `${API}/locations/${locationId}/product-settings`, {
          schema: z.array(locationProductSettingSchema),
        }),
      setProductSettings: (
        locationId: string,
        productId: string,
        body: SetLocationProductRequest,
      ) =>
        http.request('PUT', `${API}/locations/${locationId}/products/${productId}/settings`, {
          body,
          schema: locationProductSettingSchema,
        }),
    },
    floor: {
      get: (locationId: string) =>
        http.request('GET', `${API}/locations/${locationId}/floor`, {
          schema: z.array(tableSectionSchema),
        }),
      createSection: (locationId: string, body: CreateTableSectionRequest) =>
        http.request('POST', `${API}/locations/${locationId}/floor/sections`, {
          body,
          schema: z.array(tableSectionSchema),
        }),
      archiveSection: (locationId: string, sectionId: string) =>
        http.request('POST', `${API}/locations/${locationId}/floor/sections/${sectionId}/archive`, {
          schema: z.array(tableSectionSchema),
        }),
      createTable: (locationId: string, body: CreateTableRequest) =>
        http.request('POST', `${API}/locations/${locationId}/floor/tables`, {
          body,
          schema: z.array(tableSectionSchema),
        }),
      updateTable: (locationId: string, tableId: string, body: UpdateTableRequest) =>
        http.request('PATCH', `${API}/locations/${locationId}/floor/tables/${tableId}`, {
          body,
          schema: z.array(tableSectionSchema),
        }),
      archiveTable: (locationId: string, tableId: string) =>
        http.request('POST', `${API}/locations/${locationId}/floor/tables/${tableId}/archive`, {
          schema: z.array(tableSectionSchema),
        }),
    },
    orders: {
      /** Idempotent: resending the same `id` returns the existing order. */
      create: (locationId: string, body: CreateOrderRequest) =>
        http.request('POST', `${API}/locations/${locationId}/orders`, {
          body,
          schema: orderSchema,
        }),
      list: (locationId: string, query: OrderListFilter = {}) =>
        http.request('GET', `${API}/locations/${locationId}/orders`, {
          query: {
            status: query.status?.join(','),
            open: query.open ? 'true' : undefined,
            businessDate: query.businessDate,
            tableId: query.tableId,
            limit: query.limit,
          },
          schema: z.array(orderSchema),
        }),
      get: (locationId: string, orderId: string) =>
        http.request('GET', `${API}/locations/${locationId}/orders/${orderId}`, {
          schema: orderSchema,
        }),
      update: (locationId: string, orderId: string, body: UpdateOrderRequest) =>
        http.request('PUT', `${API}/locations/${locationId}/orders/${orderId}`, {
          body,
          schema: orderSchema,
        }),
      transition: (locationId: string, orderId: string, body: TransitionOrderRequest) =>
        http.request('POST', `${API}/locations/${locationId}/orders/${orderId}/transitions`, {
          body,
          schema: orderSchema,
        }),
    },
    menu: {
      categories: crud(
        http,
        'categories',
        categorySchema,
        createCategorySchema,
        updateCategorySchema,
      ),
      kitchenStations: crud(
        http,
        'kitchen-stations',
        kitchenStationSchema,
        createKitchenStationSchema,
        updateKitchenStationSchema,
      ),
      modifierGroups: crud(
        http,
        'modifier-groups',
        modifierGroupSchema,
        createModifierGroupSchema,
        updateModifierGroupSchema,
      ),
      taxes: crud(http, 'taxes', taxSchema, createTaxSchema, updateTaxSchema),
      discounts: crud(
        http,
        'discounts',
        discountSchema,
        createDiscountSchema,
        updateDiscountSchema,
      ),
      products: {
        ...crud(http, 'products', productSchema, createProductSchema, updateProductSchema),
        list: (restaurantId: string, query: ListProductsQuery = {}) =>
          http.request('GET', `${API}/restaurants/${restaurantId}/products`, {
            query: { ...query },
            schema: z.array(productSchema),
          }),
      },
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** Shared CRUD + archive/restore calls for restaurant-scoped catalog resources. */
function crud<S extends z.ZodType, C extends z.ZodType, U extends z.ZodType>(
  http: HttpClient,
  resource: string,
  schema: S,
  // Request schemas type the bodies; the server validates them authoritatively.
  _createSchema: C,
  _updateSchema: U,
) {
  const base = (restaurantId: string) => `${API}/restaurants/${restaurantId}/${resource}`;
  return {
    list: (restaurantId: string, options: { includeArchived?: boolean } = {}) =>
      http.request('GET', base(restaurantId), {
        query: { includeArchived: options.includeArchived ? 'true' : undefined },
        schema: z.array(schema),
      }),
    get: (restaurantId: string, id: string) =>
      http.request('GET', `${base(restaurantId)}/${id}`, { schema }),
    create: (restaurantId: string, body: z.input<C>) =>
      http.request('POST', base(restaurantId), { body, schema }),
    update: (restaurantId: string, id: string, body: z.input<U>) =>
      http.request('PATCH', `${base(restaurantId)}/${id}`, { body, schema }),
    archive: (restaurantId: string, id: string) =>
      http.request('POST', `${base(restaurantId)}/${id}/archive`, { schema }),
    restore: (restaurantId: string, id: string) =>
      http.request('POST', `${base(restaurantId)}/${id}/restore`, { schema }),
  };
}
