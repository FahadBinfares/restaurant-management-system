import "dotenv/config";
import { createDatabase } from "../database.js";
import { parseEnvironment } from "../env.js";

/** Synthetic demo catalog, drivers, and customers. Development databases only. */
async function main() {
  const env = parseEnvironment(process.env);
  if (env.APP_ENV !== "development") {
    console.error("Refusing to seed: APP_ENV must be development.");
    process.exitCode = 1;
    return;
  }
  const { client: db, disconnect } = createDatabase(env.DATABASE_URL);
  try {
    if (await db.category.count() > 0) {
      console.info("Catalog already has data; nothing seeded.");
      return;
    }
    const categories = await Promise.all(
      [["الأطباق الرئيسية", 0], ["المقبلات", 1], ["الحلويات", 2], ["المشروبات", 3]].map(([name, sortOrder]) =>
        db.category.create({ data: { name: name as string, sortOrder: sortOrder as number } })),
    );
    const [mains, starters, desserts, drinks] = categories;
    const product = (categoryId: string, name: string, price: number) => db.product.create({ data: { categoryId, name, price } });
    const lamb = await product(mains!.id, "خروف كامل مع الرز", 180_000);
    const mandi = await product(mains!.id, "مندي دجاج", 4_500);
    const kabsa = await product(mains!.id, "كبسة لحم", 6_500);
    const salad = await product(starters!.id, "سلطة خضراء", 1_500);
    const sambosa = await product(starters!.id, "سمبوسة (10 حبات)", 2_000);
    const kunafa = await product(desserts!.id, "كنافة صينية", 7_500);
    await product(drinks!.id, "لبن", 300);
    await product(drinks!.id, "مياه (كرتون)", 1_800);

    await db.package.create({
      data: {
        name: "وليمة 20 شخص", guestCount: 20, price: 280_000,
        description: "خروف كامل مع الرز والمقبلات والحلى",
        items: { create: [
          { productId: lamb.id, quantity: 1, position: 0 },
          { productId: salad.id, quantity: 4, position: 1 },
          { productId: sambosa.id, quantity: 4, position: 2 },
          { productId: kunafa.id, quantity: 2, position: 3 },
        ] },
      },
    });
    await db.package.create({
      data: {
        name: "وليمة 10 أشخاص", guestCount: 10, price: 95_000,
        items: { create: [
          { productId: kabsa.id, quantity: 10, position: 0 },
          { productId: salad.id, quantity: 2, position: 1 },
          { productId: mandi.id, quantity: 2, position: 2 },
        ] },
      },
    });
    await db.driver.createMany({ data: [
      { name: "سائق تجريبي 1", phone: "+966590000001" },
      { name: "سائق تجريبي 2", phone: "+966590000002" },
    ] });
    await db.customer.create({
      data: {
        name: "عميل تجريبي", phone: "+966580000001",
        addresses: { create: [{ label: "المنزل", details: "الرياض - عنوان تجريبي" }] },
      },
    });
    console.info("Seeded synthetic catalog, drivers, and a demo customer.");
  } finally {
    await disconnect();
  }
}

await main();
