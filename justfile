default:
    @just --list

# Build this linked checkout, restart the local DSH web service, and verify readiness.
deploy-local:
    #!/usr/bin/env bash
    set -euo pipefail

    dsh_home="$HOME/.local/state/dsh"
    plugin_link="$dsh_home/profiles/web/node_modules/@lamplitisles/dsh-companion"
    repository="$(pwd -P)"
    linked_repository="$(readlink -f "$plugin_link" 2>/dev/null || true)"

    if [[ "$linked_repository" != "$repository" ]]; then
      printf 'refusing deployment: %s resolves to %s, expected %s\n' \
        "$plugin_link" "${linked_repository:-<missing>}" "$repository" >&2
      exit 1
    fi

    bun run build
    systemctl --user restart dsh.service

    for attempt in {1..15}; do
      if [[ "$(systemctl --user is-active dsh.service)" == "active" ]] \
        && curl -fsS -o /dev/null http://127.0.0.1:3080/companion/; then
        printf 'deployed %s to %s (dsh.service active, /companion/ ready)\n' \
          "$repository" "$dsh_home"
        exit 0
      fi
      sleep 1
    done

    printf 'deployment failed: dsh.service did not make /companion/ ready within 15 seconds\n' >&2
    exit 1
