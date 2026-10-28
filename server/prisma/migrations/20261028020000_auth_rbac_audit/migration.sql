/*
  Warnings:

  - You are about to drop the `DevelopmentProbe` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'reception', 'operations');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "archivedAt" TIMESTAMPTZ(3);

-- DropTable
DROP TABLE "DevelopmentProbe";

-- CreateTable
CREATE TABLE "Employee" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "phone" VARCHAR(13) NOT NULL,
    "role" "Role" NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(3),
    "totpSecret" VARCHAR(64),
    "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PermissionOverride" (
    "employeeId" UUID NOT NULL,
    "permission" VARCHAR(64) NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PermissionOverride_pkey" PRIMARY KEY ("employeeId","permission")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "userAgent" VARCHAR(255),
    "ipAddress" VARCHAR(64),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" BIGSERIAL NOT NULL,
    "actorId" UUID,
    "action" VARCHAR(64) NOT NULL,
    "entityType" VARCHAR(32) NOT NULL,
    "entityId" VARCHAR(64),
    "before" JSONB,
    "after" JSONB,
    "reason" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "sessionIdleMinutes" INTEGER NOT NULL DEFAULT 30,
    "draftArchiveDays" INTEGER NOT NULL DEFAULT 30,
    "alertLeadMinutes" INTEGER NOT NULL DEFAULT 60,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerAddress" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "label" VARCHAR(60) NOT NULL,
    "details" VARCHAR(500) NOT NULL,
    "mapsUrl" VARCHAR(1000),
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CustomerAddress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Employee_phone_key" ON "Employee"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_employeeId_revokedAt_idx" ON "Session"("employeeId", "revokedAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "CustomerAddress_customerId_idx" ON "CustomerAddress"("customerId");

-- AddForeignKey
ALTER TABLE "PermissionOverride" ADD CONSTRAINT "PermissionOverride_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAddress" ADD CONSTRAINT "CustomerAddress_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Invariants Prisma cannot express.
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_phone_canonical" CHECK ("phone" ~ '^\+9665[0-9]{8}$');
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_failedLoginCount_nonnegative" CHECK ("failedLoginCount" >= 0);
ALTER TABLE "Session" ADD CONSTRAINT "Session_expiry_after_creation" CHECK ("expiresAt" > "createdAt");
ALTER TABLE "Settings" ADD CONSTRAINT "Settings_singleton" CHECK ("id" = 1);
ALTER TABLE "Settings" ADD CONSTRAINT "Settings_sessionIdleMinutes_allowed" CHECK ("sessionIdleMinutes" IN (15, 30, 60));
ALTER TABLE "Settings" ADD CONSTRAINT "Settings_draftArchiveDays_allowed" CHECK ("draftArchiveDays" IN (15, 30, 60));
ALTER TABLE "Settings" ADD CONSTRAINT "Settings_alertLeadMinutes_allowed" CHECK ("alertLeadMinutes" IN (30, 60, 120));
INSERT INTO "Settings" ("id", "updatedAt") VALUES (1, CURRENT_TIMESTAMP);

-- Audit history is append-only.
CREATE FUNCTION "audit_log_immutable"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog rows are append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "AuditLog_no_update_delete" BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION "audit_log_immutable"();
