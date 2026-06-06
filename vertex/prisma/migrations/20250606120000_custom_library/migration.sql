-- Phase 6: user custom GLB library (custom_elements + custom_prefabs)

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'custom_library_saved';

-- CreateTable
CREATE TABLE "custom_elements" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "glbPath" TEXT NOT NULL,
    "parentStockId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custom_elements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_prefabs" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "glbPath" TEXT NOT NULL,
    "parentStockId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custom_prefabs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "custom_elements_userId_idx" ON "custom_elements"("userId");

-- CreateIndex
CREATE INDEX "custom_prefabs_userId_idx" ON "custom_prefabs"("userId");

-- AddForeignKey
ALTER TABLE "custom_elements" ADD CONSTRAINT "custom_elements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_prefabs" ADD CONSTRAINT "custom_prefabs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
