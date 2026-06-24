import { z } from "zod";

export const IncidentIdSchema = z.string().uuid();

export function isIncidentId(value: string): boolean {
  return IncidentIdSchema.safeParse(value).success;
}
