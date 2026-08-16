import type { NewCustomerDraft } from '../types';
import type { ValidationResult } from './types';
import { VALID } from './types';

// F5d-65 — BUSINESS_RULES.md "Intake Workflow & Required Fields": name and
// phone are required to create a new customer record; email is optional.
// Bounds mirror the Worker's own parseServiceJobIntake() limits for the same
// three fields (200/64/320) so a value accepted here is never later rejected
// by the Worker for being oversized — one set of limits, not two that could
// drift apart.
const MAX_NAME_LENGTH = 200;
const MAX_PHONE_LENGTH = 64;
const MAX_EMAIL_LENGTH = 320;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateNewCustomerInput(input: NewCustomerDraft): ValidationResult {
  const errors: Record<string, string> = {};

  const name = input.name.trim();
  if (!name) errors.name = 'กรุณากรอกชื่อลูกค้า';
  else if (name.length > MAX_NAME_LENGTH) errors.name = 'ชื่อลูกค้ายาวเกินไป';

  const phone = input.phone.trim();
  if (!phone) errors.phone = 'กรุณากรอกเบอร์โทรศัพท์';
  else if (phone.length > MAX_PHONE_LENGTH) errors.phone = 'เบอร์โทรศัพท์ยาวเกินไป';

  const email = input.email.trim();
  if (email) {
    if (email.length > MAX_EMAIL_LENGTH) errors.email = 'อีเมลยาวเกินไป';
    else if (!EMAIL_PATTERN.test(email)) errors.email = 'รูปแบบอีเมลไม่ถูกต้อง';
  }

  if (Object.keys(errors).length > 0) return { valid: false, errors };
  return VALID;
}
