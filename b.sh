#!/bin/sh
set -e
cd /home/claude/lifehub/app
node node_modules/typescript/bin/tsc --noEmit
npm run build 2>&1 | tail -3
node scripts/build-single.mjs 2>&1 | tail -1
cp LifeHub.html ../LifeHub.html
echo DONE
