import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import {
  CurrentPrincipal,
  type Principal,
  RequirePermissions,
  ZodValidationPipe,
} from '@pos/server';
import {
  type Employee,
  type Role,
  type StaffUser,
  createEmployeeSchema,
  createRoleSchema,
  createUserSchema,
  idSchema,
  resetPasswordSchema,
  setPinSchema,
  setUserRolesSchema,
  updateEmployeeSchema,
  updateRoleSchema,
  updateUserSchema,
} from '@pos/validation';
import type { z } from 'zod';
import { assertAnyRestaurantWide } from '../scope';
import { EmployeesService } from './employees.service';
import { RolesService } from './roles.service';
import { UsersService } from './users.service';

const id = new ZodValidationPipe(idSchema);

/**
 * Users, roles and employees (cloud only; hubs receive them through the change feed). All routes
 * are restaurant-wide: a branch manager cannot manage staff.
 */
@Controller('restaurants/:restaurantId')
export class StaffController {
  constructor(
    private readonly users: UsersService,
    private readonly roles: RolesService,
    private readonly employees: EmployeesService,
  ) {}

  // --- Users -------------------------------------------------------------------------------------

  @RequirePermissions(['users.manage'])
  @Get('users')
  listUsers(@Param('restaurantId', id) restaurantId: string): Promise<StaffUser[]> {
    return this.users.list(restaurantId);
  }

  @RequirePermissions(['users.manage'])
  @Post('users')
  createUser(
    @Param('restaurantId', id) _restaurantId: string,
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(createUserSchema)) body: z.output<typeof createUserSchema>,
  ): Promise<StaffUser> {
    return this.users.create(principal, body);
  }

  @RequirePermissions(['users.manage'])
  @Patch('users/:userId')
  updateUser(
    @Param('restaurantId', id) _restaurantId: string,
    @Param('userId', id) userId: string,
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(updateUserSchema)) body: z.output<typeof updateUserSchema>,
  ): Promise<StaffUser> {
    return this.users.update(principal, userId, body);
  }

  @RequirePermissions(['users.manage'])
  @Put('users/:userId/roles')
  setUserRoles(
    @Param('restaurantId', id) _restaurantId: string,
    @Param('userId', id) userId: string,
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(setUserRolesSchema)) body: z.output<typeof setUserRolesSchema>,
  ): Promise<StaffUser> {
    return this.users.setRoles(principal, userId, body.roles);
  }

  @RequirePermissions(['users.manage'])
  @Post('users/:userId/password')
  @HttpCode(204)
  resetPassword(
    @Param('restaurantId', id) _restaurantId: string,
    @Param('userId', id) userId: string,
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(resetPasswordSchema)) body: z.output<typeof resetPasswordSchema>,
  ): Promise<void> {
    return this.users.resetPassword(principal, userId, body.password);
  }

  // --- Roles -------------------------------------------------------------------------------------

  /** Readable by whoever manages roles or assigns them to users. */
  @RequirePermissions([])
  @Get('roles')
  listRoles(
    @Param('restaurantId', id) restaurantId: string,
    @CurrentPrincipal() principal: Principal,
  ): Promise<Role[]> {
    assertAnyRestaurantWide(principal, ['roles.manage', 'users.manage']);
    return this.roles.list(restaurantId);
  }

  @RequirePermissions(['roles.manage'])
  @Post('roles')
  createRole(
    @Param('restaurantId', id) _restaurantId: string,
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(createRoleSchema)) body: z.output<typeof createRoleSchema>,
  ): Promise<Role> {
    return this.roles.create(principal, body);
  }

  @RequirePermissions(['roles.manage'])
  @Patch('roles/:roleId')
  updateRole(
    @Param('restaurantId', id) _restaurantId: string,
    @Param('roleId', id) roleId: string,
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(updateRoleSchema)) body: z.output<typeof updateRoleSchema>,
  ): Promise<Role> {
    return this.roles.update(principal, roleId, body);
  }

  @RequirePermissions(['roles.manage'])
  @Delete('roles/:roleId')
  @HttpCode(204)
  deleteRole(
    @Param('restaurantId', id) _restaurantId: string,
    @Param('roleId', id) roleId: string,
    @CurrentPrincipal() principal: Principal,
  ): Promise<void> {
    return this.roles.remove(principal, roleId);
  }

  // --- Employees ---------------------------------------------------------------------------------

  @RequirePermissions(['users.manage'])
  @Get('employees')
  listEmployees(@Param('restaurantId', id) restaurantId: string): Promise<Employee[]> {
    return this.employees.list(restaurantId);
  }

  @RequirePermissions(['users.manage'])
  @Post('employees')
  createEmployee(
    @Param('restaurantId', id) _restaurantId: string,
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(createEmployeeSchema)) body: z.output<typeof createEmployeeSchema>,
  ): Promise<Employee> {
    return this.employees.create(principal, body);
  }

  @RequirePermissions(['users.manage'])
  @Patch('employees/:employeeId')
  updateEmployee(
    @Param('restaurantId', id) _restaurantId: string,
    @Param('employeeId', id) employeeId: string,
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(updateEmployeeSchema)) body: z.output<typeof updateEmployeeSchema>,
  ): Promise<Employee> {
    return this.employees.update(principal, employeeId, body);
  }

  @RequirePermissions(['users.manage'])
  @Put('employees/:employeeId/pin')
  setPin(
    @Param('restaurantId', id) _restaurantId: string,
    @Param('employeeId', id) employeeId: string,
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(setPinSchema)) body: z.output<typeof setPinSchema>,
  ): Promise<Employee> {
    return this.employees.setPin(principal, employeeId, body.pin);
  }
}
