import { Prisma } from "@prisma/client";

export function isUniqueConstraintViolation(err: unknown) {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") {
    return false;
  }

  const target = err.meta?.target;
  if (Array.isArray(target)) {
    return target.includes("txHash") && target.includes("logIndex");
  }

  if (typeof target === "string") {
    return target.includes("txHash") && target.includes("logIndex");
  }

  return false;
}
