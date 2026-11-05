import "dotenv/config";
import jwt from "jsonwebtoken";
import { loadConfig } from "../src/config";
import { createPrisma } from "../src/lib/prisma";

async function main(): Promise<void> {
  const investorId = process.argv[2];
  if (!investorId) {
    console.error("Usage: npm run token -- <investorId>");
    process.exit(1);
  }

  const config = loadConfig();
  const prisma = createPrisma();
  try {
    const investor = await prisma.investor.findUnique({ where: { id: investorId } });
    if (!investor) {
      console.error(`Investor not found: ${investorId}`);
      process.exit(1);
    }
    const token = jwt.sign(
      { tenant_id: investor.tenant_id, investor_id: investor.id },
      config.jwtSecret,
      { algorithm: "HS256", expiresIn: "1h" },
    );
    console.log(token);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
