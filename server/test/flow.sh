#!/bin/sh
# End-to-end smoke test against a running API.
#
# Walks the real customer and provider journeys with curl, asserting on the
# response each time. Exits non-zero on the first failure so it is usable in CI.
#
#   sh test/flow.sh [base-url]
set -eu

API="${1:-http://localhost:4000}"
PASS="DemoPass123!"
JAR=$(mktemp -d)
FAILED=0

note() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAILED=1; }

# assert <description> <condition-string-present> <haystack>
assert_has() {
  if printf '%s' "$3" | grep -q "$2"; then ok "$1"; else bad "$1 (looking for '$2')"; printf '    got: %s\n' "$(printf '%s' "$3" | head -c 300)"; fi
}
assert_missing() {
  if printf '%s' "$3" | grep -q "$2"; then bad "$1 (should not contain '$2')"; else ok "$1"; fi
}

login() { # login <email> <jarname>
  curl -s -c "$JAR/$2" -X POST "$API/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$PASS\"}"
}
as() { # as <jarname> <curl args...>
  jar="$1"; shift
  curl -s -b "$JAR/$jar" -c "$JAR/$jar" "$@"
}

# json <key> — FIRST value for a key. Must use grep -o, not sed: a greedy `.*`
# prefix in sed matches the LAST occurrence, which silently returns a nested
# object's id instead of the top-level one.
json() {
  grep -o "\"$1\":\"[^\"]*\"" | head -1 | cut -d: -f2- | tr -d '"'
}

note "1. Health"
H=$(curl -s "$API/api/health")
assert_has "API reports healthy" '"ok":true' "$H"

note "2. Public catalogue (no auth)"
C=$(curl -s "$API/api/catalog/services")
assert_has "services listed" 'Pre-Purchase Building Inspection' "$C"
SERVICE_ID=$(printf '%s' "$C" | grep -o '"id":"[0-9a-f-]*","name":"Pre-Purchase Building Inspection"' \
  | head -1 | cut -d'"' -f4)
[ -n "$SERVICE_ID" ] && ok "service id resolved" || bad "could not resolve service id"

note "3. Coverage check"
COV=$(curl -s "$API/api/catalog/coverage?postcode=4051")
assert_has "4051 is covered" '"covered":true' "$COV"
NOCOV=$(curl -s "$API/api/catalog/coverage?postcode=9999")
assert_has "9999 is not covered" '"covered":false' "$NOCOV"

note "4. Auth"
BADLOGIN=$(curl -s -X POST "$API/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"customer@example.com","password":"wrong-password"}')
assert_has "wrong password rejected" 'incorrect' "$BADLOGIN"
assert_missing "no password hash leaked" 'passwordHash' "$BADLOGIN"

L=$(login customer@example.com cust)
assert_has "customer can log in" '"role":"CUSTOMER"' "$L"
assert_missing "login response carries no hash" 'passwordHash' "$L"

note "5. Authorisation boundaries"
FORB=$(as cust "$API/api/admin/overview")
assert_has "customer blocked from admin" 'does not have access' "$FORB"
ANON=$(curl -s "$API/api/bookings")
assert_has "anonymous blocked from bookings" 'UNAUTHORIZED' "$ANON"

note "6. Availability"
AV=$(curl -s "$API/api/catalog/availability?serviceId=$SERVICE_ID&postcode=4051&days=7")
assert_has "slots offered for a covered postcode" '"slots"' "$AV"
SLOT=$(printf '%s' "$AV" | json start)
[ -n "$SLOT" ] && ok "slot resolved: $SLOT" || bad "no slot returned"

AV_UNCOVERED=$(curl -s "$API/api/catalog/availability?serviceId=$SERVICE_ID&postcode=9999&days=7")
assert_has "uncovered postcode offers nothing" '"totalSlots":0' "$AV_UNCOVERED"

note "7. Booking"
BK=$(as cust -X POST "$API/api/bookings" -H 'Content-Type: application/json' -d "{
  \"serviceId\":\"$SERVICE_ID\",
  \"scheduledStart\":\"$SLOT\",
  \"customerNotes\":\"Smoke test booking\",
  \"address\":{\"line1\":\"7 Test Street\",\"city\":\"Brisbane\",\"region\":\"QLD\",\"postcode\":\"4051\"}
}")
assert_has "booking created awaiting payment" 'PENDING_PAYMENT' "$BK"
JOB_ID=$(printf '%s' "$BK" | json id)
REF=$(printf '%s' "$BK" | json reference)
[ -n "$JOB_ID" ] && ok "job id $JOB_ID ($REF)" || bad "no job id returned"

note "8. Booking an uncovered postcode is refused"
BADAREA=$(as cust -X POST "$API/api/bookings" -H 'Content-Type: application/json' -d "{
  \"serviceId\":\"$SERVICE_ID\",
  \"scheduledStart\":\"$SLOT\",
  \"address\":{\"line1\":\"1 Nowhere Rd\",\"city\":\"Nowhere\",\"region\":\"XX\",\"postcode\":\"9999\"}
}")
assert_has "outside-area booking rejected" "don't cover postcode 9999" "$BADAREA"

note "9. A job awaiting payment is NOT on the marketplace"
login provider@example.com prov > /dev/null
BOARD=$(as prov "$API/api/provider/jobs/available")
assert_missing "unpaid job absent from the board" "$REF" "$BOARD"

note "10. Checkout"
PAY=$(as cust -X POST "$API/api/bookings/$JOB_ID/confirm-mock-payment" \
  -H 'Content-Type: application/json' -d '{"succeed":true}')
assert_has "payment clears and job opens" '"status":"OPEN"' "$PAY"

note "11. Paid job appears on the provider board"
BOARD=$(as prov "$API/api/provider/jobs/available")
assert_has "paid job now on the board" "$REF" "$BOARD"
assert_missing "street address withheld before accepting" '7 Test Street' "$BOARD"

note "12. Accept"
ACC=$(as prov -X POST "$API/api/provider/jobs/$JOB_ID/accept")
assert_has "provider accepts the job" '"status":"ASSIGNED"' "$ACC"
assert_has "address unlocked after accepting" '7 Test Street' "$ACC"

note "13. A second provider cannot take the same job"
login provider2@example.com prov2 > /dev/null
RACE=$(as prov2 -X POST "$API/api/provider/jobs/$JOB_ID/accept")
assert_has "second accept refused" 'JOB_TAKEN\|not set up to provide\|outside the areas' "$RACE"

note "14. Unrelated provider cannot read the job"
SNOOP=$(as prov2 "$API/api/provider/jobs/$JOB_ID")
assert_has "other provider blocked from job detail" 'not assigned to you' "$SNOOP"

note "15. Do the work"
EN=$(as prov -X POST "$API/api/provider/jobs/$JOB_ID/status" -H 'Content-Type: application/json' -d '{"to":"EN_ROUTE"}')
assert_has "en route" '"status":"EN_ROUTE"' "$EN"
IP=$(as prov -X POST "$API/api/provider/jobs/$JOB_ID/status" -H 'Content-Type: application/json' -d '{"to":"IN_PROGRESS"}')
assert_has "in progress" '"status":"IN_PROGRESS"' "$IP"

note "16. Completing without the required report parks it"
DONE=$(as prov -X POST "$API/api/provider/jobs/$JOB_ID/status" -H 'Content-Type: application/json' -d '{"to":"COMPLETED"}')
assert_has "held at awaiting report" 'AWAITING_REPORT' "$DONE"

note "17. Uploading the report completes the job"
printf '%%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%%%EOF\n' > "$JAR/report.pdf"
UP=$(as prov -X POST "$API/api/provider/jobs/$JOB_ID/documents" \
  -F 'kind=JOB_REPORT' -F "files=@$JAR/report.pdf;type=application/pdf")
assert_has "report accepted and job completed" '"status":"COMPLETED"' "$UP"
DOC_ID=$(printf '%s' "$UP" | json id)

note "18. An executable upload is refused"
printf '<?php system($_GET[0]); ?>' > "$JAR/shell.php"
EVIL=$(as prov -X POST "$API/api/provider/jobs/$JOB_ID/documents" \
  -F 'kind=JOB_REPORT' -F "files=@$JAR/shell.php;type=application/x-php")
assert_has "php upload rejected" 'not accepted' "$EVIL"

note "19. Document access control"
DOCOK=$(as cust -o /dev/null -w '%{http_code}' "$API/api/documents/$DOC_ID")
[ "$DOCOK" = "200" ] && ok "customer can read their own job report" || bad "customer got $DOCOK on own report"
DOCNO=$(as prov2 -o /dev/null -w '%{http_code}' "$API/api/documents/$DOC_ID")
[ "$DOCNO" = "403" ] && ok "unrelated provider gets 403" || bad "unrelated provider got $DOCNO, expected 403"
DOCANON=$(curl -s -o /dev/null -w '%{http_code}' "$API/api/documents/$DOC_ID")
[ "$DOCANON" = "401" ] && ok "anonymous gets 401" || bad "anonymous got $DOCANON, expected 401"

note "20. Payout is owed but not yet sent"
EARN=$(as prov "$API/api/provider/earnings")
assert_has "earnings show a pending payout" '"pendingCents"' "$EARN"

note "21. Admin"
login admin@example.com adm > /dev/null
OV=$(as adm "$API/api/admin/overview")
assert_has "admin overview loads" 'counters' "$OV"
EX=$(as adm "$API/api/admin/exceptions")
assert_has "exceptions queue loads" '"exceptions"' "$EX"
PQ=$(as adm "$API/api/admin/providers?status=PENDING")
assert_has "pending provider awaits review" 'Okafor' "$PQ"

# A bad filter value must be a clean 400, not a 500 echoing the query shape.
JUNK=$(as adm "$API/api/admin/jobs?status=NOT_A_STATUS")
assert_has "invalid status filter is a validation error" 'BAD_REQUEST' "$JUNK"
assert_missing "invalid filter leaks no query internals" 'prisma\.' "$JUNK"

note "22. Admin releases the payout"
POUTS=$(as adm "$API/api/admin/payouts?status=PENDING")
POUT_ID=$(printf '%s' "$POUTS" | json id)
if [ -n "$POUT_ID" ]; then
  SENT=$(as adm -X POST "$API/api/admin/payouts/$POUT_ID/send")
  assert_has "payout sent" '"status":"PAID"' "$SENT"
else
  bad "no pending payout found to send"
fi

note "23. Notifications were recorded"
NOTIF=$(as adm "$API/api/admin/notifications")
assert_has "booking confirmation recorded" 'booking_confirmed' "$NOTIF"
assert_has "provider assignment recorded" 'provider_assigned' "$NOTIF"
assert_has "notifications actually sent" '"status":"SENT"' "$NOTIF"

note "24. Provider approval"
PID=$(printf '%s' "$PQ" | json id)
if [ -n "$PID" ]; then
  APPR=$(as adm -X POST "$API/api/admin/providers/$PID/review" \
    -H 'Content-Type: application/json' -d '{"decision":"APPROVED"}')
  assert_has "approval succeeds for a complete application" '"status":"APPROVED"' "$APPR"

  # Put the review queue back, so this script is re-runnable against the same
  # database instead of passing once and then failing at step 21 forever.
  as adm -X POST "$API/api/admin/providers/$PID/review" \
    -H 'Content-Type: application/json' -d '{"decision":"PENDING"}' > /dev/null
  REQUEUED=$(as adm "$API/api/admin/providers?status=PENDING")
  assert_has "review queue restored for the next run" 'Okafor' "$REQUEUED"
else
  bad "could not resolve the pending provider id"
fi

rm -rf "$JAR"
note "Result"
if [ "$FAILED" = "0" ]; then
  printf '\033[32mAll checks passed\033[0m\n'
else
  printf '\033[31mSome checks FAILED\033[0m\n'
fi
exit "$FAILED"
