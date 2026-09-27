"""
Browser walkthrough of all three surfaces.

Drives the real UI against the real API and screenshots every screen at phone
and desktop width. Asserts on rendered text, so a page that loads but renders an
error is a FAIL rather than a passing screenshot.

  python test/walkthrough.py [base-url]

Notes that cost time to rediscover:
  * Chromium needs --proxy-server=direct:// to reach localhost here.
  * browser.new_page() starts a FRESH context and would be logged out — this
    script creates each context explicitly and reuses its page.
  * Screenshots are viewport-only and <=2000px in both dimensions.
"""

import sys
import pathlib
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5173"
PASSWORD = "DemoPass123!"
SHOTS = pathlib.Path(__file__).parent / "screens"
SHOTS.mkdir(exist_ok=True)

DESKTOP = {"width": 1280, "height": 860}
PHONE = {"width": 390, "height": 780}

CHROME_ARGS = [
    "--proxy-server=direct://",
    "--proxy-bypass-list=*",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
]

failures = []
passes = []


def ok(msg):
    passes.append(msg)
    print(f"  \033[32mPASS\033[0m {msg}")


def bad(msg):
    failures.append(msg)
    print(f"  \033[31mFAIL\033[0m {msg}")


def check(cond, msg):
    ok(msg) if cond else bad(msg)


def shot(page, name):
    page.screenshot(path=str(SHOTS / f"{name}.png"))
    print(f"       → screens/{name}.png")


def has_text(page, needle, timeout=6000, quiet=False):
    """
    True if the text appears. A miss is not fatal — some checks assert absence.

    On an unexpected miss it prints the URL and headings, because a false FAIL
    from the harness costs as much as a false pass and is far easier to chase
    with the page state in front of you.
    """
    # Must target the first VISIBLE match, not the first match. The responsive
    # header keeps its desktop nav in the DOM and hides it with CSS at phone
    # width, so a bare `text=` selector resolves to that hidden link and then
    # waits for it to become visible until it times out — a false FAIL on a
    # page that is rendering perfectly.
    try:
        page.locator(f"text={needle} >> visible=true").first.wait_for(
            state="visible", timeout=timeout
        )
        return True
    except PWTimeout:
        if not quiet:
            try:
                heads = page.locator("h1, h2").all_inner_texts()[:4]
                print(f"       [miss] {needle!r} · url={page.url} · headings={heads}")
            except Exception:
                pass
        return False


def settle(page):
    page.wait_for_load_state("networkidle")
    # Let the one-shot entrance animation finish before capturing.
    page.wait_for_timeout(500)


def login(page, email):
    page.goto(f"{BASE}/login")
    settle(page)
    page.fill('input[type="email"]', email)
    page.fill('input[type="password"]', PASSWORD)
    page.click('button[type="submit"]')
    settle(page)


def new_ctx(browser, viewport):
    """Explicit context so the page keeps its session cookies."""
    ctx = browser.new_context(viewport=viewport, ignore_https_errors=True)
    return ctx, ctx.new_page()


def run(p):
    browser = p.chromium.launch(headless=True, args=CHROME_ARGS)

    # ------------------------------------------------------ public pages
    print("\n\033[1m1. Public site\033[0m")
    ctx, page = new_ctx(browser, DESKTOP)
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    page.goto(BASE)
    settle(page)
    check(has_text(page, "Book a licensed provider"), "home page renders the hero")
    check(has_text(page, "Full Home Inspection"), "services load from the API")
    check(not has_text(page, "That didn't load", 1200, quiet=True), "no load error on the home page")
    shot(page, "01-home-desktop")

    # Postcode coverage check, on the hero.
    page.fill('input[aria-label="ZIP code"]', "75201")
    page.click('button:has-text("Check")')
    check(has_text(page, "Covered"), "covered postcode reports coverage")
    shot(page, "02-home-coverage-covered")

    page.fill('input[aria-label="ZIP code"]', "99999")
    page.click('button:has-text("Check")')
    check(has_text(page, "not in 99999"), "uncovered ZIP says so plainly")

    ctx.close()

    # Mobile home
    ctx, page = new_ctx(browser, PHONE)
    page.goto(BASE)
    settle(page)
    check(has_text(page, "Book a licensed provider"), "home page renders on a phone")
    # The page must not scroll sideways at 390px.
    overflow = page.evaluate(
        "() => document.documentElement.scrollWidth - document.documentElement.clientWidth"
    )
    check(overflow <= 1, f"no horizontal overflow on phone home (got {overflow}px)")
    shot(page, "03-home-phone")
    ctx.close()

    # ------------------------------------------------- customer booking
    print("\n\033[1m2. Customer booking flow\033[0m")
    ctx, page = new_ctx(browser, DESKTOP)
    login(page, "customer@example.com")
    check(has_text(page, "My bookings"), "customer lands on their bookings")
    shot(page, "04-customer-orders")

    page.goto(f"{BASE}/book")
    settle(page)
    check(has_text(page, "What do you need done?"), "booking step 1 renders")
    shot(page, "05-book-step1-service")

    page.click('button:has-text("Four-Point Inspection")')
    settle(page)
    check(has_text(page, "Which property?"), "advances to the property step")

    page.fill('input[autocomplete="address-line1"]', "12 Walkthrough Street")
    page.fill('input[autocomplete="address-level2"]', "Dallas")
    page.fill('input[autocomplete="address-level1"]', "TX")
    page.fill('input[autocomplete="postal-code"]', "75024")
    # Coverage is checked on a debounce.
    page.wait_for_timeout(900)
    settle(page)
    check(has_text(page, "we cover"), "live coverage confirmation appears")

    # Property details drive the price (SOP 3.3 / 3.6). A Four-Point asks for
    # the year built; a 1968 home is over 50, so the surcharge must fire and
    # the total must move from $175 to $210 without leaving the page.
    check(has_text(page, "About the property"), "service asks for the property details it needs")
    page.fill('input[type="number"][max="%d"]' % __import__("datetime").date.today().year, "1968")
    page.wait_for_timeout(900)
    settle(page)
    check(has_text(page, "Your price"), "live itemised price appears")
    check(has_text(page, "over 50 years"), "the age surcharge rule fires and is named")
    check(has_text(page, "$210"), "the total reflects the rule, not just the base price")
    shot(page, "06-book-step2-property")
    # The itemised price sits below the fold on desktop — capture it directly.
    page.locator("text=Your price >> visible=true").first.scroll_into_view_if_needed()
    page.wait_for_timeout(300)
    shot(page, "06b-book-live-price")

    page.click('button:has-text("Choose a time")')
    settle(page)
    check(has_text(page, "Pick a day"), "availability loads")
    shot(page, "07-book-step3-time")

    # First available time chip.
    page.locator(".chip").filter(has_text=":").nth(0)
    slots = page.locator("div.grid button.chip")
    if slots.count() == 0:
        bad("no time slots rendered")
    else:
        slots.nth(0).click()
        ok(f"time slot selectable ({slots.count()} offered)")

    page.click('button:has-text("Continue to payment")')
    settle(page)
    check(has_text(page, "Confirm and pay"), "reaches the payment step")
    check(has_text(page, "Demo checkout"), "checkout states that payments are simulated")
    shot(page, "08-book-step4-pay")

    page.click('button:has-text("Pay ")')
    settle(page)
    check(has_text(page, "You're booked in"), "payment completes and confirms")
    check(has_text(page, "Finding a provider"), "job goes live on the marketplace")
    shot(page, "09-order-tracking")

    # Grab the reference so the provider side can find this exact job.
    ref = page.locator("span.ref").first.inner_text().strip()
    print(f"       booking reference: {ref}")
    ctx.close()

    # ------------------------------------------------- provider portal
    print("\n\033[1m3. Provider portal\033[0m")
    ctx, page = new_ctx(browser, PHONE)
    login(page, "provider2@example.com")
    check(has_text(page, "Job board"), "approved provider lands on the board")
    check(has_text(page, ref), "the new job is on the board")
    shot(page, "10-provider-board-phone")

    overflow = page.evaluate(
        "() => document.documentElement.scrollWidth - document.documentElement.clientWidth"
    )
    check(overflow <= 1, f"no horizontal overflow on the phone board (got {overflow}px)")

    # Accept the job we just created.
    card = page.locator("div.surface").filter(has_text=ref)
    card.locator('button:has-text("Accept")').first.click()
    settle(page)
    check(has_text(page, "Job accepted") or has_text(page, "it's yours", quiet=True), "provider accepts the job")
    check(has_text(page, "12 Walkthrough Street"), "street address unlocks after accepting")
    shot(page, "11-provider-job-accepted")

    # Work the job through to completion.
    page.click('button:has-text("on the way")')
    settle(page)
    check(has_text(page, "On the way"), "marks en route")

    page.click('button:has-text("arrived")')
    settle(page)
    check(has_text(page, "In progress"), "marks arrived / in progress")
    shot(page, "12-provider-job-in-progress")

    page.click('button:has-text("Mark work complete")')
    settle(page)
    # Smoke alarm checks require a report, so it must hold, not complete.
    check(
        has_text(page, "Report outstanding"),
        "completing without the report parks the job at awaiting-report",
    )
    shot(page, "13-provider-awaiting-report")

    # Upload the report and confirm it closes out.
    pdf = SHOTS.parent / "sample-report.pdf"
    pdf.write_bytes(
        b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\n"
        b"trailer<</Root 1 0 R>>\n%%EOF\n"
    )
    with page.expect_file_chooser() as fc:
        page.click('button:has-text("Upload the report")')
    fc.value.set_files(str(pdf))
    settle(page)
    page.wait_for_timeout(800)
    check(has_text(page, "Completed"), "uploading the report completes the job")
    shot(page, "14-provider-job-complete")

    page.goto(f"{BASE}/provider/earnings")
    settle(page)
    check(has_text(page, "Awaiting payment"), "earnings page renders")
    shot(page, "15-provider-earnings-phone")
    ctx.close()

    # Desktop board + onboarding for an unapproved provider
    ctx, page = new_ctx(browser, DESKTOP)
    login(page, "provider@example.com")
    settle(page)
    shot(page, "16-provider-board-desktop")
    ctx.close()

    ctx, page = new_ctx(browser, DESKTOP)
    login(page, "provider3@example.com")
    settle(page)
    check(
        has_text(page, "Get verified") or has_text(page, "under review", quiet=True),
        "unapproved provider is held in onboarding",
    )
    check(not has_text(page, "Job board", 1200, quiet=True), "unapproved provider cannot see the job board")
    shot(page, "17-provider-onboarding")
    ctx.close()

    # -------------------------------------------------------- admin
    print("\n\033[1m4. Admin dashboard\033[0m")
    ctx, page = new_ctx(browser, DESKTOP)
    login(page, "admin@example.com")
    check(has_text(page, "Dashboard"), "admin lands on the dashboard")
    check(has_text(page, "Revenue"), "revenue tile renders")
    check(has_text(page, "Job pipeline"), "pipeline renders")
    shot(page, "18-admin-dashboard")

    page.goto(f"{BASE}/admin/jobs")
    settle(page)
    check(has_text(page, ref), "the walkthrough job appears in admin jobs")
    shot(page, "19-admin-jobs")

    page.click(f'a:has-text("{ref}")')
    settle(page)
    check(has_text(page, "Admin actions"), "admin job detail renders")
    check(has_text(page, "Audit trail"), "audit trail renders")
    check(has_text(page, "12 Walkthrough Street"), "admin sees the property address")
    shot(page, "20-admin-job-detail")

    page.goto(f"{BASE}/admin/providers?status=PENDING")
    settle(page)
    check(has_text(page, "Okafor"), "provider review queue shows the pending applicant")
    shot(page, "21-admin-providers-pending")

    page.click('a:has-text("Okafor")')
    settle(page)
    check(has_text(page, "Verification decision"), "provider review page renders")
    check(has_text(page, "Documents"), "documents listed for review")
    shot(page, "22-admin-provider-review")

    page.goto(f"{BASE}/admin/money?tab=payouts")
    settle(page)
    check(has_text(page, "Payouts out"), "payouts tab renders")
    shot(page, "23-admin-payouts")

    page.goto(f"{BASE}/admin/exceptions")
    settle(page)
    check(has_text(page, "Exceptions"), "exceptions queue renders")
    shot(page, "24-admin-exceptions")

    page.goto(f"{BASE}/admin/areas")
    settle(page)
    check(has_text(page, "Service areas"), "coverage page renders")
    check(has_text(page, "TX"), "markets grouped by state")
    shot(page, "25-admin-coverage")

    page.goto(f"{BASE}/admin/areas")
    settle(page)
    page.click('button:has-text("Services & pricing")')
    settle(page)
    check(has_text(page, "Inspector payout"), "pricing table renders")
    check(has_text(page, "size tiers"), "square-footage tiers are shown per service")
    shot(page, "26-admin-pricing")

    # SOP 10: the platform fee must be configuration, not code.
    page.click('button:has-text("Platform fee")')
    settle(page)
    check(has_text(page, "Default inspector share"), "platform fee screen renders")
    check(has_text(page, "Inspector keeps"), "the split is an editable setting")
    check(has_text(page, "Your gross share"), "the worked example shows the platform share")
    shot(page, "27-admin-platform-fee")
    ctx.close()

    # ------------------------------------------------ access control
    print("\n\033[1m5. Access control in the browser\033[0m")
    ctx, page = new_ctx(browser, DESKTOP)
    login(page, "customer@example.com")
    page.goto(f"{BASE}/admin")
    settle(page)
    check(not has_text(page, "Job pipeline", 1500, quiet=True), "customer cannot reach the admin dashboard")
    ctx.close()

    ctx, page = new_ctx(browser, DESKTOP)
    page.goto(f"{BASE}/admin")
    settle(page)
    check(has_text(page, "Sign in"), "anonymous visitor is sent to sign-in")
    ctx.close()

    if errors:
        bad(f"{len(errors)} uncaught JS error(s): {errors[:3]}")
    else:
        ok("no uncaught JavaScript errors")

    browser.close()


with sync_playwright() as p:
    run(p)

print(f"\n\033[1mResult\033[0m  {len(passes)} passed, {len(failures)} failed")
if failures:
    print("\033[31mFailures:\033[0m")
    for f in failures:
        print(f"  · {f}")
    sys.exit(1)
print("\033[32mAll browser checks passed.\033[0m")
