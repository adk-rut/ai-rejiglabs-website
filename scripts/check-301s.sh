#!/usr/bin/env bash
# check-301s.sh — assert every Beem redirect in vercel.json is live.
#
#   scripts/check-301s.sh                      # against https://rejiglabs.com
#   scripts/check-301s.sh http://localhost:3000
#
# vercel.json IS the map — no second copy to drift. Vercel's `permanent: true`
# emits 308 (a 301 with the method preserved), so both are accepted.
set -u
BASE="${1:-https://rejiglabs.com}"; BASE="${BASE%/}"
cd "$(dirname "$0")/.."

# emit "<path>\t<expected Location>" per redirect, with :params filled in
CASES=$(node -e '
const rs = require("./vercel.json").redirects.filter(r => /^https:\/\/heybeem\.com/.test(r.destination));
for (const r of rs) {
  let src = r.source, dest = r.destination;
  // :name(a|b|c) -> first alternative
  src = src.replace(/:(\w+)\(([^)]+)\)/g, (_, n, alts) => {
    dest = dest.replace(":" + n, alts.split("|")[0]); return alts.split("|")[0];
  });
  // :name* -> a two-segment sample (the catch-all case)
  src = src.replace(/:(\w+)\*/g, "deep/page");
  console.log(src + "\t" + dest);
}')

fail=0; n=0
while IFS=$'\t' read -r path want; do
  n=$((n+1))
  read -r code loc <<<"$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$BASE$path")"
  if [ "$code" != "301" ] && [ "$code" != "308" ]; then
    echo "FAIL $path -> $code (want 301/308)"; fail=$((fail+1)); continue
  fi
  if [ "${loc%/}" != "${want%/}" ]; then
    echo "FAIL $path -> $loc (want $want)"; fail=$((fail+1)); continue
  fi
  echo "ok   $path -> $code $loc"
done <<<"$CASES"

echo "--- $((n-fail))/$n passed against $BASE"
[ "$fail" -eq 0 ]
