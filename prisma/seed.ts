import "dotenv/config";
import jwt from "jsonwebtoken";
import { loadConfig } from "../src/config";
import { createPrisma } from "../src/lib/prisma";
import {
  INVESTOR_A_EMAIL,
  INVESTOR_A_ID,
  INVESTOR_B_EMAIL,
  INVESTOR_B_ID,
  TENANT_A_ID,
  TENANT_A_NAME,
  TENANT_B_ID,
  TENANT_B_NAME,
} from "./ids";

async function main(): Promise<void> {
  const config = loadConfig();
  const prisma = createPrisma();

  try {
    await prisma.tenant.upsert({
      where: { id: TENANT_A_ID },
      create: { id: TENANT_A_ID, name: TENANT_A_NAME },
      update: { name: TENANT_A_NAME },
    });
    await prisma.tenant.upsert({
      where: { id: TENANT_B_ID },
      create: { id: TENANT_B_ID, name: TENANT_B_NAME },
      update: { name: TENANT_B_NAME },
    });

    await prisma.investor.upsert({
      where: { id: INVESTOR_A_ID },
      create: {
        id: INVESTOR_A_ID,
        tenant_id: TENANT_A_ID,
        email: INVESTOR_A_EMAIL,
        kyc_status: "pending",
      },
      update: {},
    });
    await prisma.investor.upsert({
      where: { id: INVESTOR_B_ID },
      create: {
        id: INVESTOR_B_ID,
        tenant_id: TENANT_B_ID,
        email: INVESTOR_B_EMAIL,
        kyc_status: "pending",
      },
      update: {},
    });

    const sampleToken = jwt.sign(
      { tenant_id: TENANT_A_ID, investor_id: INVESTOR_A_ID },
      config.jwtSecret,
      { algorithm: "HS256", expiresIn: "1h" },
    );

    console.log("Seeded tenants and investors.");
    console.log(`Investor A ${INVESTOR_A_ID} ${INVESTOR_A_EMAIL} tenant ${TENANT_A_ID}`);
    console.log(`Investor B ${INVESTOR_B_ID} ${INVESTOR_B_EMAIL} tenant ${TENANT_B_ID}`);
    console.log("Sample JWT for Investor A (expires in 1h):");
    console.log(sampleToken);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
