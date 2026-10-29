import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { SyncOperationStatus } from '@pos/shared-types';
import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { Prisma as HubPrisma } from '../generated/hub-client';

/**
 * The location hub runs the cloud's application services against SQLite, injecting its own
 * Prisma client where the services expect the cloud client. That is only sound while both clients
 * expose exactly the same models, fields, relations and enums — which this test enforces.
 */
const HUB_ONLY_MODELS = new Set(['SyncOperation', 'HubState', 'InboundOrder']);
const HUB_ONLY_ENUMS = new Set(['SyncOperationStatus']);
/**
 * Sync ledger, change feed, website order numbers, and the tenant website and its domains (ADR
 * 0023) exist only in the cloud (`/// @cloud-only`).
 */
const CLOUD_ONLY_MODELS = new Set([
  'ProcessedOperation',
  'ChangeLog',
  'WebOrderCounter',
  'TenantDomain',
  'WebsiteConfig',
  // Payment provider secrets never leave the cloud (ADR 0024).
  'PaymentProviderSecret',
  // The platform's operators, their audit trail and error events (ADR 0025).
  'PlatformUser',
  'PlatformRefreshToken',
  'PlatformAuditLog',
  'PlatformErrorEvent',
  // Releases and each tenant's release channel (ADR 0026).
  'Release',
  'TenantReleaseChannel',
]);
const CLOUD_ONLY_ENUMS = new Set([
  'ProcessedOperationStatus',
  'ChangeTopic',
  'SyncIssueResolution',
  'PlatformRole',
  'ReleaseChannel',
]);

type Datamodel = typeof Prisma.dmmf.datamodel;

function shape(
  datamodel: Datamodel,
  skipModels = new Set<string>(),
  skipEnums = new Set<string>(),
) {
  return {
    models: datamodel.models
      .filter((m) => !skipModels.has(m.name))
      .map((m) => ({
        name: m.name,
        dbName: m.dbName,
        primaryKey: m.primaryKey,
        uniqueFields: m.uniqueFields,
        // A relation to a model the other side does not have is left out with that model.
        fields: m.fields
          .filter((f) => !skipModels.has(f.type))
          .map((f) => ({
            name: f.name,
            dbName: f.dbName,
            kind: f.kind,
            type: f.type,
            isList: f.isList,
            isRequired: f.isRequired,
            isId: f.isId,
            isUnique: f.isUnique,
            isUpdatedAt: f.isUpdatedAt,
            hasDefaultValue: f.hasDefaultValue,
            relationName: f.relationName,
            relationFromFields: f.relationFromFields,
            relationToFields: f.relationToFields,
          })),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    enums: datamodel.enums
      .filter((e) => !skipEnums.has(e.name))
      .map((e) => ({ name: e.name, dbName: e.dbName, values: e.values.map((v) => v.name) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

describe('hub (SQLite) schema', () => {
  it('is generated from the current cloud schema', () => {
    expect(() =>
      execFileSync('node', ['scripts/hub-schema.mjs', '--check'], {
        cwd: resolve(import.meta.dirname, '..'),
        stdio: 'pipe',
      }),
    ).not.toThrow();
  });

  it('has exactly the cloud models, fields, relations and enums', () => {
    expect(shape(HubPrisma.dmmf.datamodel, HUB_ONLY_MODELS, HUB_ONLY_ENUMS)).toEqual(
      shape(Prisma.dmmf.datamodel, CLOUD_ONLY_MODELS, CLOUD_ONLY_ENUMS),
    );
  });

  it('mirrors the shared outbox status enum', () => {
    const hubEnum = HubPrisma.dmmf.datamodel.enums.find((e) => e.name === 'SyncOperationStatus');
    expect(hubEnum?.values.map((v) => v.name).sort()).toEqual(
      Object.values(SyncOperationStatus).sort(),
    );
  });
});
