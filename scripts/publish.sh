#!/bin/sh
# Publishes the committed desktop/ folder to the nindo-desktop repository
# (git remote "desktop-site"), which deploys it to GitHub Pages. Adds one
# commit on top of that repository's main, so its history is never rewritten.
set -eu
cd "$(git rev-parse --show-toplevel)"
git fetch -q desktop-site main
tree=$(git rev-parse HEAD:desktop)
if [ "$tree" = "$(git rev-parse FETCH_HEAD^{tree})" ]; then
  echo "Already published."
  exit 0
fi
commit=$(git log -1 --format=%B HEAD | git commit-tree "$tree" -p FETCH_HEAD)
git push desktop-site "$commit:refs/heads/main"
