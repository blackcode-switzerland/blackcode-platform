# Liberation Sans, vendored

`LiberationSans-Regular.ttf` and `LiberationSans-Bold.ttf`, version **2.1.5**, from
the official release:

- release: https://github.com/liberationfonts/liberation-fonts/releases/tag/2.1.5
- archive: `liberation-fonts-ttf-2.1.5.tar.gz`, sha256
  `7191c669bf38899f73a2094ed00f7b800553364f90e2637010a69c0e268f25d0`
- `LiberationSans-Regular.ttf` sha256 `76d04c18ea243f426b7de1f3ad208e927008f961dc5945e5aad352d0dfde8ee8`
- `LiberationSans-Bold.ttf` sha256 `788abee4c806d660e8aee46689dd8540cd4bb98da03dcc9d171ce3efd99a9173`

Licensed under the **SIL Open Font License 1.1**; the full text is `LICENSE` beside
these files, and it must travel with them.

**Why this font.** The QR-bill standard (§3.4) permits exactly four fonts for the
payment part: Arial, Frutiger, Helvetica and Liberation Sans. Liberation Sans is
the only one of the four that may be redistributed, which is what embedding it in
every PDF this app produces does. Vendored rather than fetched, because a render
must not depend on a network, and a font that changed under us would change the
bytes of a document whose fingerprint was already recorded (position P10).
