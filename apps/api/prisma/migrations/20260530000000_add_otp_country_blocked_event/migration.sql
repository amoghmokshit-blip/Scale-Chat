-- Phase 2 of the OTP migration: country allow-list rejects requests before
-- any provider call. Logs the event so we can monitor SMS-pumping attempts
-- and refine the allow-list as new markets open.
ALTER TYPE "SecurityEventKind" ADD VALUE 'OTP_COUNTRY_BLOCKED';
