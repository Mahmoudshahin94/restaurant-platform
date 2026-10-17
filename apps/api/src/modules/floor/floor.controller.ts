import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  type TableSection,
  createTableSchema,
  createTableSectionSchema,
  idSchema,
  listQuerySchema,
  updateTableSchema,
  updateTableSectionSchema,
} from '@pos/validation';
import type { z } from 'zod';
import { RequirePermissions } from '../../common/auth/decorators';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { FloorService } from './floor.service';

const id = new ZodValidationPipe(idSchema);

/** Mutations return the refreshed floor so clients render one consistent state. */
@Controller('locations/:locationId/floor')
export class FloorController {
  constructor(private readonly floor: FloorService) {}

  @RequirePermissions(['orders.view'])
  @Get()
  get(
    @Param('locationId', id) locationId: string,
    @Query(new ZodValidationPipe(listQuerySchema)) q: z.output<typeof listQuerySchema>,
  ): Promise<TableSection[]> {
    return this.floor.getFloor(locationId, q.includeArchived);
  }

  @RequirePermissions(['tables.manage'])
  @Post('sections')
  async createSection(
    @Param('locationId', id) locationId: string,
    @Body(new ZodValidationPipe(createTableSectionSchema))
    body: z.output<typeof createTableSectionSchema>,
  ): Promise<TableSection[]> {
    await this.floor.createSection(locationId, body);
    return this.floor.getFloor(locationId);
  }

  @RequirePermissions(['tables.manage'])
  @Patch('sections/:sectionId')
  async updateSection(
    @Param('locationId', id) locationId: string,
    @Param('sectionId', id) sectionId: string,
    @Body(new ZodValidationPipe(updateTableSectionSchema))
    body: z.output<typeof updateTableSectionSchema>,
  ): Promise<TableSection[]> {
    await this.floor.updateSection(locationId, sectionId, body);
    return this.floor.getFloor(locationId);
  }

  @RequirePermissions(['tables.manage'])
  @Post('sections/:sectionId/archive')
  @HttpCode(200)
  async archiveSection(
    @Param('locationId', id) locationId: string,
    @Param('sectionId', id) sectionId: string,
  ): Promise<TableSection[]> {
    await this.floor.setSectionArchived(locationId, sectionId, true);
    return this.floor.getFloor(locationId);
  }

  @RequirePermissions(['tables.manage'])
  @Post('tables')
  async createTable(
    @Param('locationId', id) locationId: string,
    @Body(new ZodValidationPipe(createTableSchema)) body: z.output<typeof createTableSchema>,
  ): Promise<TableSection[]> {
    await this.floor.createTable(locationId, body);
    return this.floor.getFloor(locationId);
  }

  @RequirePermissions(['tables.manage'])
  @Patch('tables/:tableId')
  async updateTable(
    @Param('locationId', id) locationId: string,
    @Param('tableId', id) tableId: string,
    @Body(new ZodValidationPipe(updateTableSchema)) body: z.output<typeof updateTableSchema>,
  ): Promise<TableSection[]> {
    await this.floor.updateTable(locationId, tableId, body);
    return this.floor.getFloor(locationId);
  }

  @RequirePermissions(['tables.manage'])
  @Post('tables/:tableId/archive')
  @HttpCode(200)
  async archiveTable(
    @Param('locationId', id) locationId: string,
    @Param('tableId', id) tableId: string,
  ): Promise<TableSection[]> {
    await this.floor.setTableArchived(locationId, tableId, true);
    return this.floor.getFloor(locationId);
  }

  @RequirePermissions(['tables.manage'])
  @Post('tables/:tableId/restore')
  @HttpCode(200)
  async restoreTable(
    @Param('locationId', id) locationId: string,
    @Param('tableId', id) tableId: string,
  ): Promise<TableSection[]> {
    await this.floor.setTableArchived(locationId, tableId, false);
    return this.floor.getFloor(locationId);
  }
}
