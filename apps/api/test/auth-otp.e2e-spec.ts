/**
 * Phase 2 of the OTP migration — country allow-list gate.
 *
 * Verifies the gate fires BEFORE any provider call, so SMS-pumping (AIT)
 * traffic costs nothing on our side. Sets `OTP_ALLOWED_COUNTRIES=IN` for this
 * suite, then:
 *   - asserts a +1 (US) request is rejected with 400 `country_not_supported`
 *     AND no `otp_requests` row is created
 *   - asserts the rejection is logged as `OTP_COUNTRY_BLOCKED` so the founder
 *     can monitor blocked traffic
 *   - asserts an Indian number proceeds and the row is tagged with the
 *     active provider name (`dev-msg91` in the test env — no Twilio creds)
 *
 * Live Twilio smoke + happy-path verify are `it.todo` — they require live
 * credentials + an inbound SMS and are run manually per
 * `docs/progress/otp-research.md` § 5 step 4.
 */
import {
  setupTestApp,
  teardownTestApp,
  truncateAll,
  type TestApp,
} from './setup-e2e';

describe('Auth — OTP (Phase 2 country allow-list)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    // `OTP_ALLOWED_COUNTRIES=IN` is set in `test/global-setup.ts` —
    // `NestConfigModule` validates the env at module-import time so a per-suite
    // beforeAll env mutation lands too late.
    testApp = await setupTestApp();
  });

  afterAll(async () => {
    await teardownTestApp();
  });

  beforeEach(async () => {
    await truncateAll(testApp.prisma);
  });

  // Unique numbers per invocation so the per-phone rate-limit counter (Redis,
  // not Postgres — `truncateAll` doesn't touch it) starts fresh each run.
  // Indian mobile shape: +91 + 10 digits starting with 6-9.
  const uniqueIndianMobile = (): string => {
    const random = Math.floor(Math.random() * 1_000_000_000);
    return `+919${String(random).padStart(9, '0')}`;
  };
  // US format: +1 + 10 digits. Area code 202 (DC) parses cleanly under
  // libphonenumber-js as country=US.
  const uniqueUSNumber = (): string => {
    const random = Math.floor(Math.random() * 9_000_000) + 1_000_000;
    return `+1202${String(random).padStart(7, '0')}`;
  };

  it('rejects a disallowed country with 400 country_not_supported + no audit row', async () => {
    const phoneE164 = uniqueUSNumber();
    const res = await testApp.inject({
      method: 'POST',
      url: '/auth/otp/request',
      payload: { phoneE164 },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ error: { code: 'country_not_supported' } });

    // Gate must fire before persistence — zero audit rows for a blocked request.
    const otpRowCount = await testApp.prisma.otpRequest.count();
    expect(otpRowCount).toBe(0);

    // The block is logged so the founder can monitor SMS-pumping attempts.
    const events = await testApp.prisma.securityEvent.findMany({
      where: { kind: 'OTP_COUNTRY_BLOCKED' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.phoneE164).toBe(phoneE164);
  });

  it('accepts an allowed country (India) and tags the audit row with the active provider', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/auth/otp/request',
      payload: { phoneE164: uniqueIndianMobile() },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { requestId: string; expiresAt: string };
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/i);

    const otpRow = await testApp.prisma.otpRequest.findUnique({
      where: { requestId: body.requestId },
    });
    expect(otpRow).not.toBeNull();
    // No TWILIO_* env set in test → factory binds DevVerifyProvider, which
    // tags rows as 'dev-msg91'. When Twilio creds are present in prod the
    // tag becomes 'twilio'.
    expect(otpRow?.provider).toBe('dev-msg91');
  });

  it('rejects obvious-garbage phone numbers at the schema level (400 ZodError, no audit row)', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/auth/otp/request',
      payload: { phoneE164: 'not-a-phone' },
    });
    expect(res.statusCode).toBe(400);
    const otpRowCount = await testApp.prisma.otpRequest.count();
    expect(otpRowCount).toBe(0);
  });

  it.todo('live Twilio smoke — start + check + verify (manual, gated on TWILIO_* creds)');
  it.todo('happy-path verify-with-correct-code via DevVerifyProvider (needs test hook to expose the generated code)');
});
