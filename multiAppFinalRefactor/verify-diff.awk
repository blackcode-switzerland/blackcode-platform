# verify-diff.awk — the "nothing lost" comparison. Called by verify.sh, not
# meant to be run standalone.
#
# argv (in this order, all tab-separated, no comment lines):
#   1. declarations.tsv   schema.table \t delta \t reason
#   2. baseline-data.tsv  schema.table \t count \t min_id \t max_id
#   3. live-data.tsv      schema.table \t count \t min_id \t max_id
#
# min_id/max_id are "NULL" (table was/is empty) or "NOID" (no integer id
# column — count-only). Prints one line per table: PASS/INFO/FAIL, plus a
# RESULT line. Exit code is the number of failing tables (0 = clean).
#
# Portable POSIX awk — no gawk-only features (this repo's dev machine has no
# gawk guaranteed). File role is matched against FILENAME rather than counted
# via FNR==1, because an EMPTY declarations file never triggers a read at
# all, which would silently shift every later file's role by one.
#
# Invoke as: awk -v declfile=... -v basefile=... -v livefile=... -f verify-diff.awk decl base live

BEGIN { FS = "\t"; OFS = " "; fails = 0 }

FILENAME == declfile {
  decl_sum[$1] += ($2 + 0)
  decl_note[$1] = (decl_note[$1] == "" ? $3 : decl_note[$1] "; " $3)
  next
}

FILENAME == basefile {
  base_seen[$1] = 1
  base_count[$1] = $2
  base_min[$1] = $3
  base_max[$1] = $4
  next
}

FILENAME == livefile {
  live_seen[$1] = 1
  live_count[$1] = $2
  live_min[$1] = $3
  live_max[$1] = $4
}

END {
  # (c) table in baseline, missing from the live database
  for (t in base_seen) {
    if (!(t in live_seen)) {
      print "FAIL", t, "table present in baseline but MISSING from the database (had " base_count[t] " rows)"
      fails++
    }
  }

  # (d) table in the live database, missing from the baseline — new & undeclared
  for (t in live_seen) {
    if (!(t in base_seen)) {
      print "FAIL", t, "table exists in the database but is NOT in the baseline (re-run capture-baseline.sh to declare it)"
      fails++
    }
  }

  # per-table comparison, tables present in both
  for (t in base_seen) {
    if (!(t in live_seen)) continue

    bc = base_count[t] + 0
    lc = live_count[t] + 0
    delta = lc - bc

    bmin = base_min[t]; bmax = base_max[t]
    lmin = live_min[t]; lmax = live_max[t]

    noid = (bmin == "NOID")
    min_bad = 0
    max_bad = 0

    if (!noid) {
      if (bmin != "NULL") {
        if (lmin == "NULL") min_bad = 1
        else if ((lmin + 0) > (bmin + 0)) min_bad = 1
      }
      if (bmax != "NULL") {
        if (lmax == "NULL") max_bad = 1
        else if ((lmax + 0) < (bmax + 0)) max_bad = 1
      }
    }

    if (delta == 0) {
      if (min_bad || max_bad) {
        print "FAIL", t, "row count unchanged (" bc ") but id range shifted: min " bmin "->" lmin ", max " bmax "->" lmax " — a row was deleted and another inserted; this can never be declared away"
        fails++
      } else {
        print "PASS", t, "unchanged (" bc " rows)"
      }
    } else if (delta > 0) {
      if (min_bad) {
        print "FAIL", t, "count grew (" bc "->" lc ") but min(id) went from " bmin " to " lmin " — old rows are still missing even though new ones arrived"
        fails++
      } else if (max_bad) {
        print "FAIL", t, "count grew (" bc "->" lc ") but max(id) went from " bmax " to " lmax
        fails++
      } else {
        print "INFO", t, "+" delta " rows (" bc "->" lc ")"
      }
    } else {
      dsum = (t in decl_sum) ? decl_sum[t] : 0
      if ((t in decl_sum) && dsum == delta) {
        print "INFO", t, delta " rows (declared: " decl_note[t] ")"
      } else if (t in decl_sum) {
        print "FAIL", t, "count changed by " delta " but declared decrease totals " dsum " (" decl_note[t] ") — mismatch"
        fails++
      } else {
        print "FAIL", t, "count DECREASED by " (0 - delta) " (" bc "->" lc ") with no declaration — undeclared data loss"
        fails++
      }
    }
  }

  print "---"
  if (fails == 0) {
    print "RESULT", "PASS", "0 failing tables"
  } else {
    print "RESULT", "FAIL", fails, "failing table(s)"
  }
  exit (fails == 0 ? 0 : 1)
}
