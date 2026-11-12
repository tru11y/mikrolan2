import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { RolesGuard } from './roles.guard';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { VERIFIER_ALLOWED_HANDLERS } from './verifier-allowlist';

type Ctor = { name: string; prototype: Record<string, unknown> };

function controllerFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return controllerFiles(p);
    return /\.controller\.ts$/.test(e.name) ? [p] : [];
  });
}

function allControllers(): Ctor[] {
  const root = path.resolve(__dirname, '../../modules');
  const found: Ctor[] = [];
  for (const file of controllerFiles(root)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(file) as Record<string, unknown>;
    for (const v of Object.values(mod)) {
      if (typeof v === 'function' && Reflect.hasMetadata(PATH_METADATA, v)) found.push(v as unknown as Ctor);
    }
  }
  return found;
}

function handlersOf(ctrl: Ctor): { name: string; fn: object }[] {
  return Object.getOwnPropertyNames(ctrl.prototype)
    .filter((n) => n !== 'constructor' && typeof ctrl.prototype[n] === 'function')
    .filter((n) => Reflect.hasMetadata(METHOD_METADATA, ctrl.prototype[n] as object))
    .map((n) => ({ name: n, fn: ctrl.prototype[n] as object }));
}

const reflector = new Reflector();
const guard = new RolesGuard(reflector);

function verifierPasses(ctrl: Ctor, fn: object): boolean {
  const ctx = {
    getHandler: () => fn,
    getClass: () => ctrl,
    switchToHttp: () => ({ getRequest: () => ({ user: { role: UserRole.TICKET_VERIFIER, tenantId: 't', userId: 'u' } }) }),
  } as unknown as ExecutionContext;
  try {
    return guard.canActivate(ctx);
  } catch (e) {
    if (e instanceof ForbiddenException) return false;
    throw e;
  }
}

describe('TICKET_VERIFIER : deny-by-default sur TOUTES les routes du backend', () => {
  const controllers = allControllers();
  const routes = controllers.flatMap((c) => handlersOf(c).map((h) => ({ ctrl: c, ...h, key: `${c.name}.${h.name}` })));

  it('le parcours couvre bien le backend (garde-fou contre un glob cassé)', () => {
    expect(controllers.length).toBeGreaterThan(25);
    expect(routes.length).toBeGreaterThan(150);
  });

  it('seules les routes allowlistées ou explicitement @Roles(TICKET_VERIFIER) passent', () => {
    const passing = routes
      .filter((r) => {
        const isPublic = Reflect.getMetadata(IS_PUBLIC_KEY, r.fn) === true || Reflect.getMetadata(IS_PUBLIC_KEY, r.ctrl) === true;
        return !isPublic && verifierPasses(r.ctrl, r.fn);
      })
      .map((r) => r.key)
      .sort();
    const explicit = routes
      .filter((r) => {
        const roles = (Reflect.getMetadata(ROLES_KEY, r.fn) ?? Reflect.getMetadata(ROLES_KEY, r.ctrl)) as UserRole[] | undefined;
        return roles?.includes(UserRole.TICKET_VERIFIER);
      })
      .map((r) => r.key);
    expect(passing).toEqual([...new Set([...VERIFIER_ALLOWED_HANDLERS, ...explicit])].sort());
    expect(passing).toHaveLength(8);
  });

  it('chaque entrée de l’allowlist désigne une route qui existe (pas d’entrée périmée)', () => {
    const keys = new Set(routes.map((r) => r.key));
    for (const k of VERIFIER_ALLOWED_HANDLERS) expect([k, keys.has(k)]).toEqual([k, true]);
  });

  it('une route ajoutée sans @Roles n’est PAS ouverte au vendeur', () => {
    class NewController { newRoute() {} }
    Reflect.defineMetadata(PATH_METADATA, 'new', NewController);
    Reflect.defineMetadata(METHOD_METADATA, 0, NewController.prototype.newRoute);
    expect(verifierPasses(NewController as unknown as Ctor, NewController.prototype.newRoute)).toBe(false);
  });
});
