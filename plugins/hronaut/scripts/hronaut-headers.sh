#!/bin/sh
# Claude Code runs this as the plugin's headersHelper each time it connects to Hronaut's MCP server. It prints the
# Authorization header from the owner-only token file Hronaut keeps in its profile, as JSON on one line, and `{}` when
# there is no such file, such as before Hronaut first ran, so the plugin's static header applies. Hronaut ignores the
# header while its MCP authentication is off. The header goes only to Claude Code's connection, never into the
# conversation.
set -u

if [ -n "${HRONAUT_USER_DATA_DIR:-}" ]; then
  profile=$HRONAUT_USER_DATA_DIR
else
  case "$(uname -s 2>/dev/null)" in
    Darwin) profile="$HOME/Library/Application Support/Hronaut" ;;
    MINGW* | MSYS* | CYGWIN*)
      appdata=${APPDATA:-}
      if [ -n "$appdata" ] && command -v cygpath >/dev/null 2>&1; then appdata=$(cygpath -u "$appdata"); fi
      profile="$appdata/Hronaut"
      ;;
    *) profile="${XDG_CONFIG_HOME:-$HOME/.config}/Hronaut" ;;
  esac
fi

token=$(tr -d '\r\n' < "$profile/mcp-token" 2>/dev/null) || token=
# Hronaut writes 32 or more URL-safe characters; anything else is not its token and is never sent.
case "$token" in
  '' | *[!A-Za-z0-9_-]*) printf '{}\n' ;;
  *)
    if [ "${#token}" -ge 32 ]; then
      printf '{"Authorization":"Bearer %s"}\n' "$token"
    else
      printf '{}\n'
    fi
    ;;
esac
