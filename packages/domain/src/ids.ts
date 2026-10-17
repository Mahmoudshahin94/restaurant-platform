import { v7 as uuidv7, validate, version } from 'uuid';

/**
 * Generates a UUIDv7. Offline nodes (the location hub) create rows with these IDs, so the same
 * identifier is used locally and in the cloud: no temporary-ID remapping is ever needed.
 */
export function newId(): string {
  return uuidv7();
}

export function isUuid(value: string): boolean {
  return validate(value);
}

export function isUuidV7(value: string): boolean {
  return validate(value) && version(value) === 7;
}
