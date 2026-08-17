-- b/books — the guard probe. Run it, read it, do not trust the guards without it.
--
-- Fourteen assertions against migration 0004 plus five against 0005's grants.
-- Runs in one transaction and ROLLS BACK, so it leaves nothing behind.
--
--   docker exec -i blackcode-postgres psql -U blackcode -d blackcode_issues -q \
--     < docs/sql/books-guard-probe.sql
--
-- ===========================================================================
-- WHY THE POSITIVE CASES ARE NOT OPTIONAL
-- ===========================================================================
-- Probes 3, 9 and 11 assert that something SUCCEEDS. Without them this file
-- cannot tell a working guard from a blanket refusal, and that is not a
-- hypothetical: the phase 0 app-boundary probe passed on 2026-08-17 while
-- `books_app` held no privilege on any table in its own schema. Every check in it
-- was a negative, and a subject that can do nothing passes all of those.
--
-- Probe 9 is the one to read first. Mockup entry 1009 is posted, balanced and
-- unrecognized, and the app's job is to resolve it later. The first version of
-- 0004 froze whole posted rows and would have made that impossible.
--
-- Probes 1, 2 and 8 also failed for the WRONG REASON on the first run: the line
-- trigger saw the parent already posted and refused its lines, which meant a
-- posted entry could not be created at all. Read the messages, not just the count.

BEGIN;

DO $probe$
DECLARE
  v_u  integer; v_ws integer; v_e integer; v_x integer;
  v_id integer; v_msg text; v_pass integer := 0; v_fail integer := 0;

  PROCEDURE_NOTE text := '';
BEGIN
  -- ---- fixtures ----
  INSERT INTO platform.users (email, name)
    VALUES ('probe@example.test', 'probe') RETURNING id INTO v_u;
  INSERT INTO books.workspaces (name, slug, owner_id)
    VALUES ('probe', 'probe-ws', v_u) RETURNING id INTO v_ws;
  INSERT INTO books.entity (workspace_id, seq, slug, name, legal_form, bookkeeping_regime)
    VALUES (v_ws, 1, 'probe-sa', 'Probe SA', 'SA', 'double_entry') RETURNING id INTO v_e;
  INSERT INTO books.exercice (workspace_id, entity_id, year, starts_on, ends_on)
    VALUES (v_ws, v_e, 2026, '2026-01-01', '2026-12-31') RETURNING id INTO v_x;
  INSERT INTO books.account (workspace_id, entity_id, no, class, label, statement, statement_position)
    VALUES (v_ws, v_e, '1020', 1, '{"fr":"Banque"}', 'bilan', 'tresorerie'),
           (v_ws, v_e, '6000', 6, '{"fr":"Loyer"}', 'cr', 'autres_charges_exploitation');

  -- ================= 1. posting an unbalanced entry =================
  BEGIN
    INSERT INTO books.entry (workspace_id, entity_id, exercice_id, seq, entry_no, date, status, raw_label)
      VALUES (v_ws, v_e, v_x, 10, 1, '2026-01-05', 'staged', 'unbalanced') RETURNING id INTO v_id;
    INSERT INTO books.entry_line (entry_id, account_no, debit, credit)
      VALUES (v_id, '6000', 100, 0), (v_id, '1020', 0, 99);
    UPDATE books.entry SET status='posted' WHERE id=v_id;
    PERFORM books.assert_entry_balanced(v_id);
    v_fail := v_fail + 1; RAISE WARNING '1 UNBALANCED POSTING: *** ALLOWED *** (guard is inert)';
  EXCEPTION WHEN others THEN
    v_pass := v_pass + 1; RAISE INFO '1 unbalanced posting REFUSED: %', SQLERRM;
  END;

  -- ================= 2. posting with a null account =================
  BEGIN
    INSERT INTO books.entry (workspace_id, entity_id, exercice_id, seq, entry_no, date, status, raw_label)
      VALUES (v_ws, v_e, v_x, 11, 2, '2026-01-05', 'staged', 'nullacct') RETURNING id INTO v_id;
    INSERT INTO books.entry_line (entry_id, account_no, debit, credit)
      VALUES (v_id, NULL, 100, 0), (v_id, '1020', 0, 100);
    UPDATE books.entry SET status='posted' WHERE id=v_id;
    PERFORM books.assert_entry_balanced(v_id);
    v_fail := v_fail + 1; RAISE WARNING '2 POSTED WITH NULL ACCOUNT: *** ALLOWED ***';
  EXCEPTION WHEN others THEN
    v_pass := v_pass + 1; RAISE INFO '2 posting with null account REFUSED: %', SQLERRM;
  END;

  -- ===== 3. a STAGED entry with a null account must SUCCEED =====
  --     The positive case. Without it, guards 1 and 2 could be a blanket refusal.
  BEGIN
    INSERT INTO books.entry (workspace_id, entity_id, exercice_id, seq, entry_no, date, status, raw_label)
      VALUES (v_ws, v_e, v_x, 12, 3, '2026-01-05', 'staged', 'staged ok') RETURNING id INTO v_id;
    INSERT INTO books.entry_line (entry_id, account_no, debit, credit)
      VALUES (v_id, NULL, 620, 0), (v_id, '1020', 0, 620);
    v_pass := v_pass + 1; RAISE INFO '3 staged entry with null account ACCEPTED (correct)';
  EXCEPTION WHEN others THEN
    v_fail := v_fail + 1; RAISE WARNING '3 STAGED ENTRY REFUSED: %  <-- guard is too broad', SQLERRM;
  END;

  -- ================= a posted, balanced entry to mutate =================
  INSERT INTO books.entry (workspace_id, entity_id, exercice_id, seq, entry_no, date, status, raw_label, evidence_tier)
    VALUES (v_ws, v_e, v_x, 20, 10, '2026-01-05', 'staged', 'UBS DEBIT REF-7719', 'bare') RETURNING id INTO v_id;
  INSERT INTO books.entry_line (entry_id, account_no, debit, credit)
    VALUES (v_id, '6000', 1850, 0), (v_id, '1020', 0, 1850);
  UPDATE books.entry SET status='posted' WHERE id=v_id;
  PERFORM books.assert_entry_balanced(v_id);
  SET CONSTRAINTS ALL IMMEDIATE;

  -- ================= 4. the date of a posted entry =================
  BEGIN
    UPDATE books.entry SET date = '2026-02-01' WHERE id = v_id;
    v_fail := v_fail + 1; RAISE WARNING '4 CHANGED A POSTED DATE: *** ALLOWED ***';
  EXCEPTION WHEN others THEN
    v_pass := v_pass + 1; RAISE INFO '4 changing a posted date REFUSED: %', SQLERRM;
  END;

  -- ================= 5. raw_label, at any status =================
  BEGIN
    UPDATE books.entry SET raw_label = 'tidied up' WHERE id = v_id;
    v_fail := v_fail + 1; RAISE WARNING '5 OVERWROTE raw_label: *** ALLOWED ***';
  EXCEPTION WHEN others THEN
    v_pass := v_pass + 1; RAISE INFO '5 overwriting raw_label REFUSED: %', SQLERRM;
  END;

  -- ================= 6. soft-deleting a posted entry =================
  BEGIN
    UPDATE books.entry SET deleted_at = now() WHERE id = v_id;
    v_fail := v_fail + 1; RAISE WARNING '6 SOFT-DELETED A POSTED ENTRY: *** ALLOWED ***';
  EXCEPTION WHEN others THEN
    v_pass := v_pass + 1; RAISE INFO '6 soft-deleting a posted entry REFUSED: %', SQLERRM;
  END;

  -- ================= 7. hard delete =================
  BEGIN
    DELETE FROM books.entry WHERE id = v_id;
    v_fail := v_fail + 1; RAISE WARNING '7 HARD-DELETED AN ENTRY: *** ALLOWED ***';
  EXCEPTION WHEN others THEN
    v_pass := v_pass + 1; RAISE INFO '7 hard delete REFUSED: %', SQLERRM;
  END;

  -- ================= 8. changing the lines of a posted entry =================
  BEGIN
    UPDATE books.entry_line SET debit = 9999 WHERE entry_id = v_id AND account_no = '6000';
    v_fail := v_fail + 1; RAISE WARNING '8 CHANGED A POSTED LINE: *** ALLOWED ***';
  EXCEPTION WHEN others THEN
    v_pass := v_pass + 1; RAISE INFO '8 changing a posted line REFUSED: %', SQLERRM;
  END;

  -- ===== 9. RESOLUTION of a posted entry must SUCCEED (entry 1009) =====
  --     The case that made this guard column-scoped instead of a blanket freeze.
  BEGIN
    UPDATE books.entry
       SET counterparty  = 'IMMOREGIE SA',
           explanation   = '{"fr":"Loyer","en":"Rent"}',
           recognition   = 'known_recurring',
           evidence_tier = 'partial',
           evidence_note = '{"fr":"Attestation reçue","en":"Attestation received"}',
           related_party = '{"counterpart":"AIOS Companion SA","kind":"loan"}',
           piece_drive_ref = 'drive://probe/x.pdf'
     WHERE id = v_id;
    v_pass := v_pass + 1; RAISE INFO '9 resolving a posted entry ACCEPTED (correct - this is the app''s main loop)';
  EXCEPTION WHEN others THEN
    v_fail := v_fail + 1; RAISE WARNING '9 RESOLVING A POSTED ENTRY REFUSED: %  <-- blocks Reconnaissance', SQLERRM;
  END;

  -- ================= 10. an SA with simplified books =================
  BEGIN
    INSERT INTO books.entity (workspace_id, seq, slug, name, legal_form, bookkeeping_regime)
      VALUES (v_ws, 2, 'bad-sa', 'Bad SA', 'SA', 'simplified');
    v_fail := v_fail + 1; RAISE WARNING '10 CREATED A SIMPLIFIED SA: *** ALLOWED *** (art. 957 breached)';
  EXCEPTION WHEN others THEN
    v_pass := v_pass + 1; RAISE INFO '10 simplified SA REFUSED: %', SQLERRM;
  END;

  -- ===== 11. an RI with simplified books must SUCCEED =====
  BEGIN
    INSERT INTO books.entity (workspace_id, seq, slug, name, legal_form, bookkeeping_regime)
      VALUES (v_ws, 3, 'ok-ri', 'Andrea RI', 'RI', 'simplified');
    v_pass := v_pass + 1; RAISE INFO '11 simplified RI ACCEPTED (correct - art. 957 al. 2)';
  EXCEPTION WHEN others THEN
    v_fail := v_fail + 1; RAISE WARNING '11 SIMPLIFIED RI REFUSED: %  <-- guard is too broad', SQLERRM;
  END;

  -- ================= 12. claiming input VAT on bare evidence =================
  BEGIN
    INSERT INTO books.entry (workspace_id, entity_id, exercice_id, seq, entry_no, date, status,
                             raw_label, evidence_tier, tva_input_claimed)
      VALUES (v_ws, v_e, v_x, 30, 20, '2026-01-05', 'staged', 'vat overclaim', 'bare', true);
    v_fail := v_fail + 1; RAISE WARNING '12 CLAIMED INPUT VAT ON BARE EVIDENCE: *** ALLOWED *** (art. 26 LTVA)';
  EXCEPTION WHEN others THEN
    v_pass := v_pass + 1; RAISE INFO '12 input VAT on bare evidence REFUSED: %', SQLERRM;
  END;

  -- ================= 13. an account mapped to a nonexistent position =================
  BEGIN
    INSERT INTO books.account (workspace_id, entity_id, no, class, label, statement, statement_position)
      VALUES (v_ws, v_e, '9999', 6, '{"fr":"x"}', 'cr', 'autre');
    v_fail := v_fail + 1; RAISE WARNING '13 MAPPED AN ACCOUNT TO A NONEXISTENT POSITION: *** ALLOWED ***';
  EXCEPTION WHEN others THEN
    v_pass := v_pass + 1; RAISE INFO '13 unmapped statement_position REFUSED: %', SQLERRM;
  END;

  -- ================= 14. a line with both a debit and a credit =================
  BEGIN
    INSERT INTO books.entry (workspace_id, entity_id, exercice_id, seq, entry_no, date, status, raw_label)
      VALUES (v_ws, v_e, v_x, 40, 30, '2026-01-05', 'staged', 'both sides') RETURNING id INTO v_id;
    INSERT INTO books.entry_line (entry_id, account_no, debit, credit) VALUES (v_id, '6000', 50, 50);
    v_fail := v_fail + 1; RAISE WARNING '14 LINE WITH BOTH DEBIT AND CREDIT: *** ALLOWED ***';
  EXCEPTION WHEN others THEN
    v_pass := v_pass + 1; RAISE INFO '14 line with both sides REFUSED: %', SQLERRM;
  END;

  RAISE INFO '================================================';
  RAISE INFO 'GUARD PROBE: % passed, % failed', v_pass, v_fail;
  RAISE INFO '================================================';
END
$probe$;

ROLLBACK;
