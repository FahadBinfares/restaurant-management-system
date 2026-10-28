import type { Agent } from "supertest";
import type { Harness } from "./harness.js";

/** Synthetic catalog: prices in halalas. */
export async function seedCatalog(h: Harness) {
  const category = await h.db.category.create({ data: { name: `أطباق ${Math.random()}` } });
  const rice = await h.db.product.create({ data: { categoryId: category.id, name: "رز", price: 5_000 } });
  const lamb = await h.db.product.create({ data: { categoryId: category.id, name: "خروف كامل", price: 150_000 } });
  const salad = await h.db.product.create({ data: { categoryId: category.id, name: "سلطة", price: 1_500 } });
  const feast = await h.db.package.create({
    data: {
      name: `وليمة 20 شخص ${Math.random()}`, guestCount: 20, price: 200_000,
      items: { create: [{ productId: lamb.id, quantity: 1, position: 0 }, { productId: rice.id, quantity: 4, position: 1 }] },
    },
  });
  return { category, rice, lamb, salad, feast };
}

let phoneSeed = 0;
export async function seedCustomer(h: Harness, name = "عميل اختبار") {
  phoneSeed += 1;
  return h.db.customer.create({
    data: {
      name, phone: `+9665${String(30_000_000 + phoneSeed).slice(-8)}`,
      addresses: { create: [{ label: "المنزل", details: "الرياض، حي الملقا", mapsUrl: "https://maps.google.com/?q=1,1" }] },
    },
    include: { addresses: true },
  });
}

/** Tomorrow at the given Riyadh hour, as an ISO string with offset. */
export function riyadhTime(h: Harness, hour: number, minute = 0, dayOffset = 1) {
  const base = new Date(h.context.now().getTime() + 3 * 3_600_000 + dayOffset * 86_400_000);
  const date = base.toISOString().slice(0, 10);
  return `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+03:00`;
}

export async function createConfirmedOrder(
  h: Harness, agent: Agent, body: Record<string, unknown>,
) {
  const created = await agent.post("/api/orders").send(body);
  if (created.status !== 201) throw new Error(`create failed ${created.status} ${JSON.stringify(created.body)}`);
  const confirmed = await agent.post(`/api/orders/${created.body.data.id}/confirm`).send({ version: created.body.data.version });
  if (confirmed.status !== 200) throw new Error(`confirm failed ${confirmed.status} ${JSON.stringify(confirmed.body)}`);
  return confirmed.body.data;
}
