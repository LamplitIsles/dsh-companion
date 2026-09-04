#!/usr/bin/env bash
# Authenticate an isolated agent-browser session to the currently running local DSH web service.
# The one-time launch token is read from this service invocation's journal and is never printed.
set -euo pipefail

readonly unit='dsh.service'
readonly origin='http://127.0.0.1:3080'
readonly session="${DSH_AGENT_BROWSER_SESSION:-dsh-live-diagnostic}"

active_since="$(systemctl --user show --property=ActiveEnterTimestamp --value "$unit")"
if [[ -z "$active_since" || "$active_since" == 'n/a' ]]; then
  printf 'DSH service is not active. Start %s first.\n' "$unit" >&2
  exit 1
fi

# BrowserAuth generates a 32-byte base64url token (43 characters) for each
# process. Restrict the match to the current service invocation so an older
# restart cannot authenticate this browser session.
token=''
for _ in {1..10}; do
  token="$({ journalctl --user --unit "$unit" --since "$active_since" --output=cat --no-pager || true; } \
    | sed -nE 's#.*[?&]token=([A-Za-z0-9_-]{43})([&#[:space:]].*)?$#\1#p' \
    | tail -n 1)"
  [[ -n "$token" ]] && break
  sleep 1
done

if [[ -z "$token" ]]; then
  printf 'No current DSH launch token appeared in the user journal within ten seconds. Check %s and retry.\n' "$unit" >&2
  exit 1
fi

# Suppress agent-browser's initial URL echo because it includes the token.
# BrowserAuth exchanges it for an HttpOnly cookie and redirects to a clean URL.
agent-browser --session "$session" --allowed-domains 127.0.0.1 open "$origin/?token=$token" >/dev/null 2>&1

if [[ $# -eq 0 ]]; then
  exec agent-browser --session "$session" snapshot -i -c
fi
exec agent-browser --session "$session" "$@"
