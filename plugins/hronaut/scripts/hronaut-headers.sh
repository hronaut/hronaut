#!/bin/sh
# Claude Code runs this as the plugin's headersHelper each time it connects to Hronaut's MCP server; on Windows
# without sh on the PATH it runs hronaut-headers.cmd instead, which does the same. It prints the Authorization header
# from the owner-only token file Hronaut keeps in its profile, as JSON on one line, and `{}` when there is no such
# file, such as before Hronaut first ran, so the plugin's static header applies. Hronaut ignores the header while its
# MCP authentication is off. The header goes only to Claude Code's connection, never into the conversation.
set -u

# Claude Code names the address the header goes to, which the plugin's MCP address option sets. The token goes only to
# a numbered port on this computer: anything after the port but a path could send it to another host.
case ${CLAUDE_CODE_MCP_SERVER_URL-} in
  http://127.0.0.1:*) port=${CLAUDE_CODE_MCP_SERVER_URL#http://127.0.0.1:} ;;
  http://localhost:*) port=${CLAUDE_CODE_MCP_SERVER_URL#http://localhost:} ;;
  'http://[::1]:'*) port=${CLAUDE_CODE_MCP_SERVER_URL#'http://[::1]:'} ;;
  *) port= ;;
esac
case ${port%%/*} in
  '' | *[!0-9]*) printf '{}\n'; exit 0 ;;
esac

# Electron names the profile folder after the app's package name, which is lowercase.
if [ -n "${HRONAUT_USER_DATA_DIR:-}" ]; then
  profile=$HRONAUT_USER_DATA_DIR
else
  case "$(uname -s 2>/dev/null)" in
    Darwin) profile="${HOME:-}/Library/Application Support/hronaut" ;;
    # Git Bash, MSYS2 and Cygwin on Windows.
    *_NT-*)
      appdata=${APPDATA:-}
      if [ -n "$appdata" ] && command -v cygpath >/dev/null 2>&1; then appdata=$(cygpath -u "$appdata"); fi
      profile="$appdata/hronaut"
      ;;
    *) profile="${XDG_CONFIG_HOME:-${HOME:-}/.config}/hronaut" ;;
  esac
fi

token=$(cat "$profile/mcp-token" 2>/dev/null) || token=
# Hronaut trims the file, so its token may follow a byte order mark or sit between spaces and line breaks.
token=${token#"$(printf '\357\273\277')"}
while :; do
  case $token in
    [[:space:]]*) token=${token#?} ;;
    *[[:space:]]) token=${token%?} ;;
    *) break ;;
  esac
done
# Hronaut writes 32 or more URL-safe characters; anything else is not its token and is never sent.
case $token in
  '' | *[!A-Za-z0-9_-]*) printf '{}\n' ;;
  *)
    if [ "${#token}" -ge 32 ]; then
      printf '{"Authorization":"Bearer %s"}\n' "$token"
    else
      printf '{}\n'
    fi
    ;;
esac
