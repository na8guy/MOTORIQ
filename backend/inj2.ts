import { buildApp } from './src/app.js';
import { prisma } from './src/lib/prisma.js';
import { hashPassword } from './src/lib/password.js';

const app = await buildApp();
const email = `inj-${Date.now()}@t.test`;
await prisma.user.create({ data: { email, passwordHash: await hashPassword('Brimful-Otter-2026'),
  emailVerified: true, wallet: { create: {} }, subscription: { create: { plan: 'FREE' } } } });

const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login',
  payload: { email, password: 'Brimful-Otter-2026' } });
const H = { authorization: `Bearer ${login.json().accessToken}` };
const CT = { ...H, 'content-type': 'application/json' };

const add = await app.inject({ method: 'POST', url: '/api/v1/vehicles', headers: CT,
  payload: { registration: 'AB12CDE', fuelType: 'PETROL' } });
const id = add.json().id;
console.log(`ADD                          ${add.statusCode}`);

// The exact shape that was failing: JSON content-type, EMPTY body.
const r1 = await app.inject({ method: 'POST', url: `/api/v1/vehicles/${id}/refresh`, headers: CT });
console.log(`REFRESH (json ct, no body)   ${r1.statusCode}  ${r1.statusCode === 200 ? '✅ fixed' : '❌ ' + r1.body.slice(0,120)}`);

const d1 = await app.inject({ method: 'DELETE', url: `/api/v1/vehicles/${id}`, headers: CT });
console.log(`DELETE  (json ct, no body)   ${d1.statusCode}  ${d1.statusCode === 204 ? '✅ fixed' : '❌ ' + d1.body.slice(0,120)}`);

// And the new client shape: no content-type at all.
const add2 = await app.inject({ method: 'POST', url: '/api/v1/vehicles', headers: CT,
  payload: { registration: 'XY34ZZZ', fuelType: 'DIESEL' } });
const id2 = add2.json().id;
const r2 = await app.inject({ method: 'POST', url: `/api/v1/vehicles/${id2}/refresh`, headers: H });
console.log(`REFRESH (no ct — new client) ${r2.statusCode}  ${r2.statusCode === 200 ? '✅' : '❌ ' + r2.body.slice(0,120)}`);

// Malformed JSON must still be rejected, and now say so.
const bad = await app.inject({ method: 'POST', url: '/api/v1/vehicles', headers: CT, payload: '{oops' });
console.log(`MALFORMED JSON               ${bad.statusCode}  ${bad.statusCode === 400 ? '✅ still rejected' : '❌'}`);

await prisma.user.delete({ where: { email } }).catch(()=>{});
await app.close();
process.exit(0);
