-- US market alignment, configurable pricing/payout rules, and per-state
-- inspector credentials.
--
-- Hand-written rather than generated so the geography columns are RENAMED
-- instead of dropped and re-added. A generated drop/add would have discarded
-- every existing address and service area.

-- ---------------------------------------------------------------- enums
ALTER TYPE "DocumentKind" RENAME VALUE 'LICENCE' TO 'LICENSE';

CREATE TYPE "CredentialKind" AS ENUM ('LICENSE', 'CERTIFICATION', 'INSURANCE', 'BOND', 'OTHER');
CREATE TYPE "PayoutMode" AS ENUM ('PERCENT', 'FIXED');
CREATE TYPE "PriceRuleKind" AS ENUM ('SQFT_TIER', 'AGE_OVER', 'ADD_ON');

-- ------------------------------------------------------------- geography
-- postcode -> zip, region -> state. Renames preserve the data.
ALTER TABLE "Address" RENAME COLUMN "postcode" TO "zip";
ALTER TABLE "Address" RENAME COLUMN "region" TO "state";
ALTER TABLE "Address" ALTER COLUMN "country" SET DEFAULT 'US';

ALTER TABLE "ServiceArea" RENAME COLUMN "postcode" TO "zip";
ALTER TABLE "ServiceArea" RENAME COLUMN "region" TO "state";
ALTER TABLE "ServiceArea" ALTER COLUMN "country" SET DEFAULT 'US';
ALTER INDEX "ServiceArea_postcode_country_key" RENAME TO "ServiceArea_zip_country_key";
ALTER INDEX "ServiceArea_region_idx" RENAME TO "ServiceArea_state_idx";

-- Existing demo rows were Australian; move them to the US default so the
-- unique key on (zip, country) stays meaningful.
UPDATE "Address" SET "country" = 'US' WHERE "country" = 'AU';
UPDATE "ServiceArea" SET "country" = 'US' WHERE "country" = 'AU';

-- ---------------------------------------------------------------- money
ALTER TABLE "Payment" ALTER COLUMN "currency" SET DEFAULT 'USD';
ALTER TABLE "Payout"  ALTER COLUMN "currency" SET DEFAULT 'USD';

-- --------------------------------------------------- inspector profile
ALTER TABLE "ProviderProfile" ADD COLUMN "legalName" TEXT;

CREATE TABLE "InspectorCredential" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "kind" "CredentialKind" NOT NULL DEFAULT 'LICENSE',
    "jurisdiction" TEXT,
    "number" TEXT NOT NULL,
    "issuedBy" TEXT,
    "issuedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "documentId" TEXT,
    "reviewState" "DocumentReviewState" NOT NULL DEFAULT 'PENDING',
    "reviewNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InspectorCredential_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InspectorCredential_providerId_idx"   ON "InspectorCredential"("providerId");
CREATE INDEX "InspectorCredential_jurisdiction_idx" ON "InspectorCredential"("jurisdiction");
CREATE INDEX "InspectorCredential_expiresAt_idx"    ON "InspectorCredential"("expiresAt");

ALTER TABLE "InspectorCredential"
  ADD CONSTRAINT "InspectorCredential_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "ProviderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InspectorCredential"
  ADD CONSTRAINT "InspectorCredential_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Carry any existing licence number across rather than losing it with the
-- column. Jurisdiction is unknown for these, so it is left null for an admin
-- to complete — an invented state would be worse than a blank one.
INSERT INTO "InspectorCredential" ("id", "providerId", "kind", "number", "reviewState", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'LICENSE', "abnOrLicenceNo", 'PENDING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "ProviderProfile"
WHERE "abnOrLicenceNo" IS NOT NULL AND btrim("abnOrLicenceNo") <> '';

ALTER TABLE "ProviderProfile" DROP COLUMN "abnOrLicenceNo";

-- ------------------------------------------------ services and pricing
ALTER TABLE "Service" ADD COLUMN "payoutMode" "PayoutMode" NOT NULL DEFAULT 'PERCENT';
ALTER TABLE "Service" ADD COLUMN "payoutPercentBp" INTEGER;
ALTER TABLE "Service" ADD COLUMN "collectsSquareFeet" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Service" ADD COLUMN "collectsYearBuilt" BOOLEAN NOT NULL DEFAULT false;

-- providerPayCents becomes optional: it is only used when payoutMode = FIXED.
-- Existing services had a fixed amount, so pin them to FIXED to preserve the
-- exact economics they were configured with, rather than silently re-pricing.
UPDATE "Service" SET "payoutMode" = 'FIXED';
ALTER TABLE "Service" ALTER COLUMN "providerPayCents" DROP NOT NULL;

CREATE TABLE "ServicePriceRule" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "kind" "PriceRuleKind" NOT NULL,
    "label" TEXT NOT NULL,
    "minValue" INTEGER,
    "maxValue" INTEGER,
    "amountCents" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ServicePriceRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ServicePriceRule_serviceId_kind_isActive_idx"
  ON "ServicePriceRule"("serviceId", "kind", "isActive");

ALTER TABLE "ServicePriceRule"
  ADD CONSTRAINT "ServicePriceRule_serviceId_fkey"
  FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ------------------------------------------------------------------ job
ALTER TABLE "Job" ADD COLUMN "squareFeet" INTEGER;
ALTER TABLE "Job" ADD COLUMN "yearBuilt" INTEGER;
ALTER TABLE "Job" ADD COLUMN "payerType" TEXT NOT NULL DEFAULT 'CUSTOMER';
ALTER TABLE "Job" ADD COLUMN "payerName" TEXT;
ALTER TABLE "Job" ADD COLUMN "priceBreakdown" JSONB;
