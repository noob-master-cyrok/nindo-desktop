#!/bin/sh
# Installs the Nindo connector on this Mac and tells Claude Code and the
# Claude app about it. Run from desktop/: sh mcp/install.sh
# Then sign in once: node ~/.local/share/nindo-mcp/nindo-mcp.mjs login
set -eu
cd "$(dirname "$0")/.."
node=$(command -v node)
npm run -s build:mcp
mkdir -p "$HOME/.local/share/nindo-mcp"
cp mcp/dist/nindo-mcp.mjs "$HOME/.local/share/nindo-mcp/nindo-mcp.mjs"
server="$HOME/.local/share/nindo-mcp/nindo-mcp.mjs"

# The project URL and the public anon key, from the desktop's .env.local.
mkdir -p "$HOME/.config/nindo-mcp"
chmod 700 "$HOME/.config/nindo-mcp"
. ./.env.local
printf '{"url":"%s","anonKey":"%s"}\n' "$VITE_SUPABASE_URL" "$VITE_SUPABASE_ANON_KEY" > "$HOME/.config/nindo-mcp/config.json"

# Claude Code, for every folder.
if command -v claude >/dev/null 2>&1; then
  claude mcp remove nindo --scope user >/dev/null 2>&1 || true
  claude mcp add nindo --scope user -- "$node" "$server"
fi

# The Claude app (chat): add or replace only the "nindo" entry.
app="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
if [ -d "$(dirname "$app")" ]; then
  "$node" -e '
    const fs = require("fs");
    const [file, node, server] = process.argv.slice(1);
    const cfg = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
    cfg.mcpServers = { ...(cfg.mcpServers ?? {}), nindo: { command: node, args: [server] } };
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
  ' "$app" "$node" "$server"
fi
echo "Installed. Sign in once with: $node $server login"
