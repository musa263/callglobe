#!/bin/sh
set -eu

pbx_dir=${1:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
env_file="$pbx_dir/.env"

fail() {
  echo "Production preflight failed: $*" >&2
  exit 1
}

[ -f "$env_file" ] || fail "missing $env_file"

value_of() {
  key=$1
  awk -v key="$key" '
    index($0, key "=") == 1 {
      print substr($0, length(key) + 2)
      found = 1
      exit
    }
    END { if (!found) exit 1 }
  ' "$env_file"
}

required() {
  name=$1
  value=$(value_of "$name" 2>/dev/null || true)
  [ -n "$value" ] || fail "$name is missing"
  case "$value" in
    *REPLACE*|*replace*|*example.com*) fail "$name still contains a placeholder" ;;
  esac
}

for name in \
  PBX_PUBLIC_IP PBX_CARRIER_BIND_IP PBX_SIP_DOMAIN PBX_WSS_DOMAIN \
  PBX_VERTO_DOMAIN TLS_CONTACT_EMAIL ESL_PASSWORD VOCIVO_WEBHOOK_SECRET \
  PSTN_GATEWAY_NAME PSTN_SIP_PROXY PSTN_SIP_USERNAME PSTN_SIP_PASSWORD \
  APNS_TEAM_ID APNS_KEY_ID APNS_BUNDLE_ID APNS_KEY_PATH \
  FCM_SERVICE_ACCOUNT_PATH TURN_REALM TURN_TLS_DOMAIN TURN_AUTH_SECRET_FILE; do
  required "$name"
done

PBX_PUBLIC_IP=$(value_of PBX_PUBLIC_IP)
TURN_REALM=$(value_of TURN_REALM)
TURN_TLS_DOMAIN=$(value_of TURN_TLS_DOMAIN)
TURN_AUTH_SECRET_FILE=$(value_of TURN_AUTH_SECRET_FILE)
APNS_KEY_PATH=$(value_of APNS_KEY_PATH)
FCM_SERVICE_ACCOUNT_PATH=$(value_of FCM_SERVICE_ACCOUNT_PATH)

[ "$(value_of APNS_ENABLED)" = true ] || fail "APNS_ENABLED must be true"
[ "$(value_of FCM_ENABLED)" = true ] || fail "FCM_ENABLED must be true"
[ "$TURN_REALM" = "$TURN_TLS_DOMAIN" ] || fail "TURN_REALM and TURN_TLS_DOMAIN must match"

case "$PBX_PUBLIC_IP" in
  *[!0-9a-fA-F:.]*) fail "PBX_PUBLIC_IP is not an IP address" ;;
esac
case "$TURN_TLS_DOMAIN" in
  ''|*[!A-Za-z0-9.-]*) fail "TURN_TLS_DOMAIN is not a valid hostname" ;;
esac

[ "$APNS_KEY_PATH" = /run/secrets/apns-auth-key.p8 ] \
  || fail "APNS_KEY_PATH must be /run/secrets/apns-auth-key.p8"
[ "$FCM_SERVICE_ACCOUNT_PATH" = /run/secrets/firebase-service-account.json ] \
  || fail "FCM_SERVICE_ACCOUNT_PATH must be /run/secrets/firebase-service-account.json"

[ -s "$pbx_dir/secrets/apns-auth-key.p8" ] || fail "APNs provider key is missing"
[ -s "$pbx_dir/secrets/firebase-service-account.json" ] || fail "Firebase service account is missing"
grep -Fq -- '-----BEGIN PRIVATE KEY-----' "$pbx_dir/secrets/apns-auth-key.p8" \
  || fail "APNs provider key is not a PKCS#8 private key"
printf '%s' "$(value_of APNS_TEAM_ID)" | grep -Eq '^[A-Z0-9]{10}$' \
  || fail "APNS_TEAM_ID must be a 10-character Apple team identifier"
printf '%s' "$(value_of APNS_KEY_ID)" | grep -Eq '^[A-Z0-9]{10}$' \
  || fail "APNS_KEY_ID must be a 10-character Apple key identifier"
grep -Eq '"type"[[:space:]]*:[[:space:]]*"service_account"' "$pbx_dir/secrets/firebase-service-account.json" \
  || fail "Firebase credential is not a service-account JSON file"
grep -Eq '"project_id"[[:space:]]*:' "$pbx_dir/secrets/firebase-service-account.json" \
  || fail "Firebase service account has no project_id"
grep -Eq '"client_email"[[:space:]]*:' "$pbx_dir/secrets/firebase-service-account.json" \
  || fail "Firebase service account has no client_email"
grep -Eq '"private_key"[[:space:]]*:' "$pbx_dir/secrets/firebase-service-account.json" \
  || fail "Firebase service account has no private_key"

case "$TURN_AUTH_SECRET_FILE" in
  /*) turn_secret_file=$TURN_AUTH_SECRET_FILE ;;
  *) turn_secret_file="$pbx_dir/${TURN_AUTH_SECRET_FILE#./}" ;;
esac
[ -s "$turn_secret_file" ] || fail "TURN shared secret is missing"
turn_secret=$(tr -d '\r\n' < "$turn_secret_file")
[ "${#turn_secret}" -ge 32 ] || fail "TURN shared secret must be at least 32 characters"
printf '%s' "$turn_secret" | grep -Eq '^[A-Za-z0-9]+$' \
  || fail "TURN shared secret must be alphanumeric"

if command -v getent >/dev/null 2>&1; then
  resolved=$(getent ahostsv4 "$TURN_TLS_DOMAIN" 2>/dev/null | awk 'NR == 1 { print $1 }')
elif command -v dig >/dev/null 2>&1; then
  resolved=$(dig +short A "$TURN_TLS_DOMAIN" 2>/dev/null | awk 'NR == 1 { print $1 }')
else
  fail "getent or dig is required for the DNS preflight"
fi
[ -n "$resolved" ] || fail "TURN_TLS_DOMAIN does not resolve in DNS"
[ "$resolved" = "$PBX_PUBLIC_IP" ] \
  || fail "TURN_TLS_DOMAIN resolves to $resolved instead of $PBX_PUBLIC_IP"

mode=$(stat -c '%a' "$turn_secret_file" 2>/dev/null || stat -f '%Lp' "$turn_secret_file")
case "$mode" in
  400|600) ;;
  *) fail "TURN shared secret permissions must be 400 or 600 (found $mode)" ;;
esac

echo "Production environment preflight passed for $TURN_TLS_DOMAIN."
