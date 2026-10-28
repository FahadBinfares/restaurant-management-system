import { z } from "zod";
import { normalizeSaudiMobile } from "../phone.js";

export const phoneSchema = z.string().max(32).transform((phone, context) => {
  const normalized = normalizeSaudiMobile(phone);
  if (!normalized) context.addIssue({ code: "custom", message: "Invalid Saudi mobile number" });
  return normalized ?? z.NEVER;
});

const positiveInteger = (max: number) => z.string().regex(/^[1-9][0-9]*$/)
  .transform(Number).pipe(z.number().int().max(max));

export const pageQuery = {
  page: positiveInteger(1_000_000).default(1),
  pageSize: positiveInteger(100).default(20),
};

export const optionalText = (max: number) => z.string().trim().max(max).nullable().optional()
  .transform((value) => value === "" ? null : value);

/** `https://` links only, so stored links cannot become `javascript:` URLs in the UI. */
export const httpsUrl = z.string().trim().max(1000).refine((value) => {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}, "Must be an https:// link");

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
