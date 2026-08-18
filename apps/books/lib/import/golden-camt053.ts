// The golden camt.053 fixtures the import door is tested against.
//
// Hand-written, arithmetic hand-checked: opening 10000.00, four booked
// movements (+5000.00, -1800.00, -398.75 with EUR fx, -45.00), one PENDING
// entry that must be skipped, closing 12756.25. `GOLDEN_OVERLAP` re-covers
// the last two movements and adds one more — the overlapping-statement case
// idempotency exists for.
//
// TS exports rather than .xml files so vitest needs no loader and the
// fixtures travel with the code that reads them.

export const GOLDEN = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">
 <BkToCstmrStmt>
  <GrpHdr><MsgId>golden-001</MsgId><CreDtTm>2026-08-18T06:00:00</CreDtTm></GrpHdr>
  <Stmt>
   <Id>stmt-2026-08-A</Id>
   <FrToDt><FrDtTm>2026-08-01T00:00:00</FrDtTm><ToDtTm>2026-08-17T23:59:59</ToDtTm></FrToDt>
   <Acct><Id><IBAN>CH21 0900 0000 1000 0060 6</IBAN></Id></Acct>
   <Bal>
    <Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp>
    <Amt Ccy="CHF">10000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd>
    <Dt><Dt>2026-08-01</Dt></Dt>
   </Bal>
   <Bal>
    <Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp>
    <Amt Ccy="CHF">12756.25</Amt><CdtDbtInd>CRDT</CdtDbtInd>
    <Dt><Dt>2026-08-17</Dt></Dt>
   </Bal>
   <Ntry>
    <NtryRef>NR-001</NtryRef>
    <Amt Ccy="CHF">5000.00</Amt>
    <CdtDbtInd>CRDT</CdtDbtInd>
    <Sts>BOOK</Sts>
    <BookgDt><Dt>2026-08-04</Dt></BookgDt>
    <AcctSvcrRef>ASR-2026-0804-771</AcctSvcrRef>
    <NtryDtls><TxDtls>
     <RltdPties><Dbtr><Nm>Nova Health Sàrl</Nm></Dbtr></RltdPties>
     <RmtInf><Ustrd>VIREMENT NOVA HEALTH SARL SOLDE PROJET</Ustrd></RmtInf>
    </TxDtls></NtryDtls>
   </Ntry>
   <Ntry>
    <NtryRef>NR-002</NtryRef>
    <Amt Ccy="CHF">1800.00</Amt>
    <CdtDbtInd>DBIT</CdtDbtInd>
    <Sts>BOOK</Sts>
    <BookgDt><Dt>2026-08-05</Dt></BookgDt>
    <AcctSvcrRef>ASR-2026-0805-102</AcctSvcrRef>
    <NtryDtls><TxDtls>
     <RltdPties><Cdtr><Nm>Régie Dubois</Nm></Cdtr></RltdPties>
     <RmtInf><Ustrd>LOYER AOUT REGIE DUBOIS</Ustrd></RmtInf>
    </TxDtls></NtryDtls>
   </Ntry>
   <Ntry>
    <NtryRef>NR-003</NtryRef>
    <Amt Ccy="CHF">398.75</Amt>
    <CdtDbtInd>DBIT</CdtDbtInd>
    <Sts>BOOK</Sts>
    <BookgDt><Dt>2026-08-08</Dt></BookgDt>
    <AcctSvcrRef>ASR-2026-0808-433</AcctSvcrRef>
    <NtryDtls><TxDtls>
     <AmtDtls>
      <InstdAmt><Amt Ccy="EUR">420.00</Amt></InstdAmt>
      <TxAmt><Amt Ccy="CHF">398.75</Amt></TxAmt>
      <XchgRate>0.9494</XchgRate>
     </AmtDtls>
     <RltdPties><Cdtr><Nm>Hetzner Online GmbH</Nm></Cdtr></RltdPties>
     <RmtInf><Ustrd>HETZNER ONLINE GMBH FACTURE 2026-08</Ustrd></RmtInf>
    </TxDtls></NtryDtls>
   </Ntry>
   <Ntry>
    <NtryRef>NR-004</NtryRef>
    <Amt Ccy="CHF">45.00</Amt>
    <CdtDbtInd>DBIT</CdtDbtInd>
    <Sts>BOOK</Sts>
    <BookgDt><Dt>2026-08-12</Dt></BookgDt>
    <AcctSvcrRef>ASR-2026-0812-951</AcctSvcrRef>
    <NtryDtls><TxDtls>
     <RltdPties><Cdtr><Nm>Café du Commerce</Nm></Cdtr></RltdPties>
     <RmtInf><Ustrd>CARTE CAFE DU COMMERCE LAUSANNE</Ustrd></RmtInf>
    </TxDtls></NtryDtls>
   </Ntry>
   <Ntry>
    <NtryRef>NR-005</NtryRef>
    <Amt Ccy="CHF">999.99</Amt>
    <CdtDbtInd>DBIT</CdtDbtInd>
    <Sts>PDNG</Sts>
    <BookgDt><Dt>2026-08-17</Dt></BookgDt>
    <AcctSvcrRef>ASR-2026-0817-000</AcctSvcrRef>
    <NtryDtls><TxDtls>
     <RmtInf><Ustrd>CARTE PENDING NOT A FACT YET</Ustrd></RmtInf>
    </TxDtls></NtryDtls>
   </Ntry>
  </Stmt>
 </BkToCstmrStmt>
</Document>`

/**
 * The next pull, overlapping the golden file: re-covers NR-003 and NR-004
 * (identical content, same references) and adds NR-006. Opening is the
 * balance before NR-003; closing extends past the new movement.
 * 12756.25 + 398.75 + 45.00 = 13200.00 back at 2026-08-07;
 * 13200.00 - 398.75 - 45.00 - 89.90 = 12666.35.
 */
export const GOLDEN_OVERLAP = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">
 <BkToCstmrStmt>
  <GrpHdr><MsgId>golden-002</MsgId><CreDtTm>2026-08-19T06:00:00</CreDtTm></GrpHdr>
  <Stmt>
   <Id>stmt-2026-08-B</Id>
   <FrToDt><FrDtTm>2026-08-07T00:00:00</FrDtTm><ToDtTm>2026-08-18T23:59:59</ToDtTm></FrToDt>
   <Acct><Id><IBAN>CH21 0900 0000 1000 0060 6</IBAN></Id></Acct>
   <Bal>
    <Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp>
    <Amt Ccy="CHF">13200.00</Amt><CdtDbtInd>CRDT</CdtDbtInd>
    <Dt><Dt>2026-08-07</Dt></Dt>
   </Bal>
   <Bal>
    <Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp>
    <Amt Ccy="CHF">12666.35</Amt><CdtDbtInd>CRDT</CdtDbtInd>
    <Dt><Dt>2026-08-18</Dt></Dt>
   </Bal>
   <Ntry>
    <NtryRef>NR-003</NtryRef>
    <Amt Ccy="CHF">398.75</Amt>
    <CdtDbtInd>DBIT</CdtDbtInd>
    <Sts>BOOK</Sts>
    <BookgDt><Dt>2026-08-08</Dt></BookgDt>
    <AcctSvcrRef>ASR-2026-0808-433</AcctSvcrRef>
    <NtryDtls><TxDtls>
     <AmtDtls>
      <InstdAmt><Amt Ccy="EUR">420.00</Amt></InstdAmt>
      <TxAmt><Amt Ccy="CHF">398.75</Amt></TxAmt>
      <XchgRate>0.9494</XchgRate>
     </AmtDtls>
     <RltdPties><Cdtr><Nm>Hetzner Online GmbH</Nm></Cdtr></RltdPties>
     <RmtInf><Ustrd>HETZNER ONLINE GMBH FACTURE 2026-08</Ustrd></RmtInf>
    </TxDtls></NtryDtls>
   </Ntry>
   <Ntry>
    <NtryRef>NR-004</NtryRef>
    <Amt Ccy="CHF">45.00</Amt>
    <CdtDbtInd>DBIT</CdtDbtInd>
    <Sts>BOOK</Sts>
    <BookgDt><Dt>2026-08-12</Dt></BookgDt>
    <AcctSvcrRef>ASR-2026-0812-951</AcctSvcrRef>
    <NtryDtls><TxDtls>
     <RltdPties><Cdtr><Nm>Café du Commerce</Nm></Cdtr></RltdPties>
     <RmtInf><Ustrd>CARTE CAFE DU COMMERCE LAUSANNE</Ustrd></RmtInf>
    </TxDtls></NtryDtls>
   </Ntry>
   <Ntry>
    <NtryRef>NR-006</NtryRef>
    <Amt Ccy="CHF">89.90</Amt>
    <CdtDbtInd>DBIT</CdtDbtInd>
    <Sts>BOOK</Sts>
    <BookgDt><Dt>2026-08-18</Dt></BookgDt>
    <AcctSvcrRef>ASR-2026-0818-207</AcctSvcrRef>
    <NtryDtls><TxDtls>
     <RltdPties><Cdtr><Nm>Swisscom SA</Nm></Cdtr></RltdPties>
     <RmtInf><Ustrd>SWISSCOM ABONNEMENT INTERNET</Ustrd></RmtInf>
    </TxDtls></NtryDtls>
   </Ntry>
  </Stmt>
 </BkToCstmrStmt>
</Document>`

/** The golden file with a lying closing balance — must be refused whole. */
export const GOLDEN_TRUNCATED = GOLDEN.replace(
  '<Amt Ccy="CHF">12756.25</Amt><CdtDbtInd>CRDT</CdtDbtInd>',
  '<Amt Ccy="CHF">12800.00</Amt><CdtDbtInd>CRDT</CdtDbtInd>'
)
