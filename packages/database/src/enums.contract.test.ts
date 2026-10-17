import {
  ActionSource,
  ActorType,
  ChangeTopic,
  CashTransactionType,
  KitchenTicketStatus,
  TicketPriority,
  DiscountType,
  OrderChannel,
  OrderStatus,
  PaymentMethodType,
  PaymentRecordStatus,
  PaymentStatus,
  PaymentTransactionType,
  ShiftStatus,
  DeviceStatus,
  DeviceType,
  LOCALES,
  OnlineOrderingState,
  FulfillmentType,
  SyncIssueResolution,
} from '@pos/shared-types';
import { $Enums } from '@prisma/client';
import { describe, expect, it } from 'vitest';

/** The database enums must match the shared contract exactly, or sync payloads will break. */
describe('Prisma enums mirror @pos/shared-types', () => {
  it.each([
    ['OnlineOrderingState', $Enums.OnlineOrderingState, OnlineOrderingState],
    ['DeviceType', $Enums.DeviceType, DeviceType],
    ['DeviceStatus', $Enums.DeviceStatus, DeviceStatus],
    ['ActionSource', $Enums.ActionSource, ActionSource],
    ['ActorType', $Enums.ActorType, ActorType],
    ['ChangeTopic', $Enums.ChangeTopic, ChangeTopic],
    ['SyncIssueResolution', $Enums.SyncIssueResolution, SyncIssueResolution],
    ['FulfillmentType', $Enums.FulfillmentType, FulfillmentType],
    ['OrderChannel', $Enums.OrderChannel, OrderChannel],
    ['OrderStatus', $Enums.OrderStatus, OrderStatus],
    ['PaymentStatus', $Enums.PaymentStatus, PaymentStatus],
    ['DiscountType', $Enums.DiscountType, DiscountType],
    ['PaymentMethodType', $Enums.PaymentMethodType, PaymentMethodType],
    ['PaymentTransactionType', $Enums.PaymentTransactionType, PaymentTransactionType],
    ['PaymentRecordStatus', $Enums.PaymentRecordStatus, PaymentRecordStatus],
    ['ShiftStatus', $Enums.ShiftStatus, ShiftStatus],
    ['CashTransactionType', $Enums.CashTransactionType, CashTransactionType],
    ['KitchenTicketStatus', $Enums.KitchenTicketStatus, KitchenTicketStatus],
    ['TicketPriority', $Enums.TicketPriority, TicketPriority],
  ])('%s', (_name, prismaEnum, sharedEnum) => {
    expect(Object.values(prismaEnum).sort()).toEqual(Object.values(sharedEnum).sort());
  });

  it('Locale', () => {
    expect(Object.values($Enums.Locale).sort()).toEqual([...LOCALES].sort());
  });
});
