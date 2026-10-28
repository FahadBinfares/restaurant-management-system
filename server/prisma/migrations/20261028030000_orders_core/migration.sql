-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('banquet', 'individual');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('draft', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "FulfillmentType" AS ENUM ('delivery', 'pickup');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('unassigned', 'assigned', 'out_for_delivery', 'delivered', 'failed');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('unpaid', 'partially_paid', 'paid');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('none', 'fixed', 'percent');

-- CreateEnum
CREATE TYPE "LineKind" AS ENUM ('product', 'package', 'custom');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('payment', 'refund');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('cash', 'bank_transfer', 'card_pos', 'payment_link');

-- CreateTable
CREATE TABLE "Category" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(1000),
    "price" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Package" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(1000),
    "guestCount" INTEGER,
    "price" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Package_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackageItem" (
    "id" UUID NOT NULL,
    "packageId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PackageItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderSequence" (
    "year" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL,

    CONSTRAINT "OrderSequence_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" UUID NOT NULL,
    "number" VARCHAR(20) NOT NULL,
    "clientRequestId" UUID,
    "orderType" "OrderType" NOT NULL DEFAULT 'individual',
    "status" "OrderStatus" NOT NULL DEFAULT 'draft',
    "customerId" UUID NOT NULL,
    "customerName" VARCHAR(120) NOT NULL,
    "customerPhone" VARCHAR(13) NOT NULL,
    "guestCount" INTEGER,
    "fulfillmentType" "FulfillmentType" NOT NULL DEFAULT 'delivery',
    "scheduledAt" TIMESTAMPTZ(3),
    "deliveryAddress" VARCHAR(500),
    "deliveryMapsUrl" VARCHAR(1000),
    "deliveryNotes" VARCHAR(1000),
    "kitchenNotes" VARCHAR(2000),
    "deliveryFee" INTEGER NOT NULL DEFAULT 0,
    "discountType" "DiscountType" NOT NULL DEFAULT 'none',
    "discountValue" INTEGER NOT NULL DEFAULT 0,
    "discountReason" VARCHAR(500),
    "vatRateBp" INTEGER NOT NULL DEFAULT 1500,
    "subtotal" INTEGER NOT NULL DEFAULT 0,
    "discountAmount" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "vatAmount" INTEGER NOT NULL DEFAULT 0,
    "paidAmount" INTEGER NOT NULL DEFAULT 0,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'unpaid',
    "deliveryStatus" "DeliveryStatus",
    "driverId" UUID,
    "deliveryFailureReason" VARCHAR(500),
    "deliveredAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "confirmedAt" TIMESTAMPTZ(3),
    "confirmedById" UUID,
    "completedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelReason" VARCHAR(500),
    "archivedAt" TIMESTAMPTZ(3),
    "createdById" UUID NOT NULL,
    "updatedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLine" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "LineKind" NOT NULL,
    "productId" UUID,
    "packageId" UUID,
    "name" VARCHAR(120) NOT NULL,
    "catalogPrice" INTEGER,
    "unitPrice" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "lineTotal" INTEGER NOT NULL,
    "priceOverrideReason" VARCHAR(500),
    "notes" VARCHAR(1000),

    CONSTRAINT "OrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLineComponent" (
    "id" UUID NOT NULL,
    "lineId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "productId" UUID,
    "name" VARCHAR(120) NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "OrderLineComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "clientRequestId" UUID,
    "orderId" UUID NOT NULL,
    "kind" "PaymentKind" NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" INTEGER NOT NULL,
    "reference" VARCHAR(120),
    "notes" VARCHAR(500),
    "receivedAt" TIMESTAMPTZ(3) NOT NULL,
    "recordedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMPTZ(3),
    "voidedById" UUID,
    "voidReason" VARCHAR(500),

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Driver" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "phone" VARCHAR(13) NOT NULL,
    "notes" VARCHAR(500),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

-- CreateIndex
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Package_name_key" ON "Package"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PackageItem_packageId_productId_key" ON "PackageItem"("packageId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_number_key" ON "Order"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Order_clientRequestId_key" ON "Order"("clientRequestId");

-- CreateIndex
CREATE INDEX "Order_status_scheduledAt_idx" ON "Order"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "Order_scheduledAt_idx" ON "Order"("scheduledAt");

-- CreateIndex
CREATE INDEX "Order_customerId_idx" ON "Order"("customerId");

-- CreateIndex
CREATE INDEX "Order_driverId_scheduledAt_idx" ON "Order"("driverId", "scheduledAt");

-- CreateIndex
CREATE INDEX "OrderLine_orderId_idx" ON "OrderLine"("orderId");

-- CreateIndex
CREATE INDEX "OrderLineComponent_lineId_idx" ON "OrderLineComponent"("lineId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_clientRequestId_key" ON "Payment"("clientRequestId");

-- CreateIndex
CREATE INDEX "Payment_orderId_idx" ON "Payment"("orderId");

-- CreateIndex
CREATE INDEX "Payment_receivedAt_idx" ON "Payment"("receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Driver_phone_key" ON "Driver"("phone");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageItem" ADD CONSTRAINT "PackageItem_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageItem" ADD CONSTRAINT "PackageItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLineComponent" ADD CONSTRAINT "OrderLineComponent_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "OrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Money and quantity invariants (integer halalas, VAT-inclusive).
ALTER TABLE "Product" ADD CONSTRAINT "Product_price_nonnegative" CHECK ("price" >= 0);
ALTER TABLE "Package" ADD CONSTRAINT "Package_price_nonnegative" CHECK ("price" >= 0);
ALTER TABLE "Package" ADD CONSTRAINT "Package_guestCount_positive" CHECK ("guestCount" IS NULL OR "guestCount" > 0);
ALTER TABLE "PackageItem" ADD CONSTRAINT "PackageItem_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_unitPrice_nonnegative" CHECK ("unitPrice" >= 0);
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_lineTotal_consistent" CHECK ("lineTotal" = "unitPrice" * "quantity");
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_kind_reference" CHECK (
  ("kind" = 'product' AND "productId" IS NOT NULL AND "packageId" IS NULL) OR
  ("kind" = 'package' AND "packageId" IS NOT NULL AND "productId" IS NULL) OR
  ("kind" = 'custom' AND "productId" IS NULL AND "packageId" IS NULL)
);
ALTER TABLE "OrderLineComponent" ADD CONSTRAINT "OrderLineComponent_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "Order" ADD CONSTRAINT "Order_number_format" CHECK ("number" ~ '^ORD-[0-9]{4}-[0-9]{4,}$');
ALTER TABLE "Order" ADD CONSTRAINT "Order_amounts_nonnegative" CHECK (
  "deliveryFee" >= 0 AND "discountValue" >= 0 AND "subtotal" >= 0 AND "discountAmount" >= 0
  AND "total" >= 0 AND "vatAmount" >= 0 AND "discountAmount" <= "subtotal"
);
ALTER TABLE "Order" ADD CONSTRAINT "Order_total_consistent" CHECK ("total" = "subtotal" - "discountAmount" + "deliveryFee");
ALTER TABLE "Order" ADD CONSTRAINT "Order_discount_percent_range" CHECK ("discountType" <> 'percent' OR "discountValue" <= 10000);
ALTER TABLE "Order" ADD CONSTRAINT "Order_version_positive" CHECK ("version" > 0);
ALTER TABLE "Order" ADD CONSTRAINT "Order_guestCount_positive" CHECK ("guestCount" IS NULL OR "guestCount" > 0);
-- Pickup orders have no delivery workflow; delivery orders always have a delivery state.
ALTER TABLE "Order" ADD CONSTRAINT "Order_delivery_state_matches_type" CHECK (
  ("fulfillmentType" = 'pickup' AND "deliveryStatus" IS NULL AND "driverId" IS NULL) OR
  ("fulfillmentType" = 'delivery' AND "deliveryStatus" IS NOT NULL)
);
ALTER TABLE "Order" ADD CONSTRAINT "Order_non_draft_scheduled" CHECK ("status" = 'draft' OR "scheduledAt" IS NOT NULL);
ALTER TABLE "Order" ADD CONSTRAINT "Order_only_drafts_archived" CHECK ("archivedAt" IS NULL OR "status" = 'draft');
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_void_complete" CHECK (
  ("voidedAt" IS NULL AND "voidedById" IS NULL AND "voidReason" IS NULL) OR
  ("voidedAt" IS NOT NULL AND "voidedById" IS NOT NULL AND "voidReason" IS NOT NULL)
);
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_phone_canonical" CHECK ("phone" ~ '^\+9665[0-9]{8}$');

-- The payment ledger is append-only: rows are never deleted, and the only
-- permitted update is voiding a not-yet-voided entry.
CREATE FUNCTION "payment_ledger_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payment rows cannot be deleted; void them instead';
  END IF;
  IF OLD."voidedAt" IS NOT NULL
     OR NEW."orderId" <> OLD."orderId" OR NEW."kind" <> OLD."kind" OR NEW."method" <> OLD."method"
     OR NEW."amount" <> OLD."amount" OR NEW."receivedAt" <> OLD."receivedAt"
     OR NEW."recordedById" <> OLD."recordedById" OR NEW."createdAt" <> OLD."createdAt"
     OR NEW."reference" IS DISTINCT FROM OLD."reference" OR NEW."notes" IS DISTINCT FROM OLD."notes" THEN
    RAISE EXCEPTION 'Payment rows are immutable except for voiding';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "Payment_append_only" BEFORE UPDATE OR DELETE ON "Payment"
  FOR EACH ROW EXECUTE FUNCTION "payment_ledger_guard"();
