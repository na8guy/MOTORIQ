import { buildApp } from './src/app.js';
import { prisma } from './src/lib/prisma.js';
import { hashPassword } from './src/lib/password.js';

const app = await buildApp();
const email = `inj-${Date.now()}@t.test`;
await prisma.user.create({ data: { email, passwordHash: await hashPassword('Brimful-Otter-2026'),
  emailVerified: true, wallet: { create: {} }, subscription: { create: { plan: 'FREE' } } } });

const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login',
  payload: { email, password: 'Brimful-Otter-2026' } });
const tok = login.json().accessToken;
const H = { authorization: `Bearer ${tok}` };

const add = await app.inject({ method: 'POST', url: '/api/v1/vehicles', headers: H,
  payload: { registration: 'AB12CDE', fuelType: 'PETROL' } });
console.log(`ADD     ${add.statusCode}`);
const id = add.json().id;

// Exactly what the app sends: a POST with no body.
const ref = await app.inject({ method: 'POST', url: `/api/v1/vehicles/${id}/refresh`, headers: H });
console.log(`REFRESH ${ref.statusCode}  ${ref.body.slice(0,200)}`);

// And with an explicit JSON content-type, which is what my curl test sent.
const ref2 = await app.inject({ method: 'POST', url: `/api/v1/vehicles/${id}/refresh`,
  headers: { ...H, 'content-type': 'application/json' } });
console.log(`REFRESH(ct) ${ref2.statusCode}  ${ref2.body.slice(0,200)}`);

const del = await app.inject({ method: 'DELETE', url: `/api/v1/vehicles/${id}`,
  headers: { ...H, 'content-type': 'application/json' } });
console.log(`DELETE(ct)  ${del.statusCode}  ${del.body.slice(0,200) || '(empty)'}`);

await prisma.user.delete({ where: { email } }).catch(()=>{});
await app.close();
