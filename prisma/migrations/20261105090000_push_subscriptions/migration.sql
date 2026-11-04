-- Notifikasi push desktop (Web Push): saluran PUSH pada antrean pengiriman + langganan per perangkat. Murni penambahan.
-- AlterEnum
ALTER TYPE "DeliveryChannel" ADD VALUE 'PUSH';

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSuccessAt" TIMESTAMP(3),

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_userId_idx" ON "push_subscriptions"("userId");

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "push_subscriptions"
  ADD CONSTRAINT "push_subscriptions_values" CHECK (
    length("endpoint") BETWEEN 20 AND 600 AND "endpoint" LIKE 'https://%' AND length("p256dh") BETWEEN 80 AND 100 AND length("auth") BETWEEN 20 AND 30
  );
