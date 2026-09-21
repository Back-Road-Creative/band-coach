// verify-appx.mjs reads AppxManifest.xml out of a real .appx (a ZIP) and
// refuses (throws) when the manifest carries a value that has already
// shipped broken twice: the version stamped from the wrong file (v1.2.0,
// Version="0.1.0.0"), and maintainer copy in the Store-facing Description
// (v1.3.0-track, fixed in PR #30). It also refuses a manifest that still
// carries the placeholder identity from store/electron-builder.json, which
// npm run dist:appx:submission's --require-identity guard is meant to
// prevent but does not itself inspect the BUILT manifest to confirm.
//
// These fixtures build the ZIP by hand (STORED, i.e. uncompressed, entries
// are valid ZIP and far simpler to construct correctly than DEFLATE) so the
// test has no dependency on `zip`/`unzip`/electron-builder being installed.
// The script under test must not care about anything else in the package —
// each fixture .appx contains nothing but AppxManifest.xml.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyAppx } from '../../store/scripts/verify-appx.mjs';

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Builds a minimal single-entry, STORED (uncompressed) ZIP containing only
// AppxManifest.xml, byte-for-byte per the PKZIP local/central/EOCD layout.
function buildAppxFixture(manifestXml) {
  const nameBuf = Buffer.from('AppxManifest.xml', 'ascii');
  const dataBuf = Buffer.from(manifestXml, 'utf8');
  const crc = crc32(dataBuf);

  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(0, 8); // stored, no compression
  localHeader.writeUInt16LE(0, 10);
  localHeader.writeUInt16LE(0, 12);
  localHeader.writeUInt32LE(crc, 14);
  localHeader.writeUInt32LE(dataBuf.length, 18);
  localHeader.writeUInt32LE(dataBuf.length, 22);
  localHeader.writeUInt16LE(nameBuf.length, 26);
  localHeader.writeUInt16LE(0, 28);

  const localOffset = 0;
  const localEntry = Buffer.concat([localHeader, nameBuf, dataBuf]);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(0, 8);
  centralHeader.writeUInt16LE(0, 10);
  centralHeader.writeUInt16LE(0, 12);
  centralHeader.writeUInt16LE(0, 14);
  centralHeader.writeUInt32LE(crc, 16);
  centralHeader.writeUInt32LE(dataBuf.length, 20);
  centralHeader.writeUInt32LE(dataBuf.length, 24);
  centralHeader.writeUInt16LE(nameBuf.length, 28);
  centralHeader.writeUInt16LE(0, 30);
  centralHeader.writeUInt16LE(0, 32);
  centralHeader.writeUInt16LE(0, 34);
  centralHeader.writeUInt16LE(0, 36);
  centralHeader.writeUInt32LE(0, 38);
  centralHeader.writeUInt32LE(localOffset, 42);

  const centralEntry = Buffer.concat([centralHeader, nameBuf]);
  const centralDirOffset = localEntry.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralEntry.length, 12);
  eocd.writeUInt32LE(centralDirOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localEntry, centralEntry, eocd]);
}

// Regression fixture for the real `Band Coach 1.3.0.0.appx` shape (tag run
// 35547760820): electron-builder's appx writer puts the ZIP64 sentinel
// (0xffffffff / 0xffff) in the classic end-of-central-directory record's
// entry count/size/offset, and in every central directory entry's
// compressed/uncompressed size and local-header-offset fields -- even for a
// file as small as AppxManifest.xml -- carrying the real 64-bit values in a
// ZIP64 extended-information extra field (id 0x0001) instead. A classic-only
// reader takes the 0xffffffff sentinel as a literal byte offset and throws
// "offset is out of range" on every real package this build produces, while
// still passing against a plain small ZIP -- which is why this fixture
// deliberately reproduces the sentinel + ZIP64 EOCD shape rather than a
// simple non-ZIP64 archive.
function buildZip64AppxFixture(manifestXml) {
  const nameBuf = Buffer.from('AppxManifest.xml', 'ascii');
  const dataBuf = Buffer.from(manifestXml, 'utf8');
  const crc = crc32(dataBuf);

  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(45, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(0, 8); // stored, no compression
  localHeader.writeUInt16LE(0, 10);
  localHeader.writeUInt16LE(0, 12);
  localHeader.writeUInt32LE(crc, 14);
  localHeader.writeUInt32LE(dataBuf.length, 18);
  localHeader.writeUInt32LE(dataBuf.length, 22);
  localHeader.writeUInt16LE(nameBuf.length, 26);
  localHeader.writeUInt16LE(0, 28);

  const localOffset = 0;
  const localEntry = Buffer.concat([localHeader, nameBuf, dataBuf]);

  // The ZIP64 extended-information extra field: id, size, then the real
  // 64-bit uncompressed size / compressed size / local header offset -- in
  // that order, matching APPNOTE.TXT 4.5.3 and the real artifact's layout.
  const zip64Extra = Buffer.alloc(4 + 24);
  zip64Extra.writeUInt16LE(0x0001, 0);
  zip64Extra.writeUInt16LE(24, 2);
  zip64Extra.writeBigUInt64LE(BigInt(dataBuf.length), 4);
  zip64Extra.writeBigUInt64LE(BigInt(dataBuf.length), 12);
  zip64Extra.writeBigUInt64LE(BigInt(localOffset), 20);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(45, 4);
  centralHeader.writeUInt16LE(45, 6);
  centralHeader.writeUInt16LE(0, 8);
  centralHeader.writeUInt16LE(0, 10);
  centralHeader.writeUInt16LE(0, 12);
  centralHeader.writeUInt16LE(0, 14);
  centralHeader.writeUInt32LE(crc, 16);
  centralHeader.writeUInt32LE(0xffffffff, 20); // ZIP64 sentinel: compressed size
  centralHeader.writeUInt32LE(0xffffffff, 24); // ZIP64 sentinel: uncompressed size
  centralHeader.writeUInt16LE(nameBuf.length, 28);
  centralHeader.writeUInt16LE(zip64Extra.length, 30);
  centralHeader.writeUInt16LE(0, 32);
  centralHeader.writeUInt16LE(0, 34);
  centralHeader.writeUInt16LE(0, 36);
  centralHeader.writeUInt32LE(0, 38);
  centralHeader.writeUInt32LE(0xffffffff, 42); // ZIP64 sentinel: local header offset

  const centralEntry = Buffer.concat([centralHeader, nameBuf, zip64Extra]);
  const centralDirOffset = localEntry.length;

  const zip64Eocd = Buffer.alloc(56);
  zip64Eocd.writeUInt32LE(0x06064b50, 0);
  zip64Eocd.writeBigUInt64LE(44n, 4); // size of remaining record
  zip64Eocd.writeUInt16LE(45, 12);
  zip64Eocd.writeUInt16LE(45, 14);
  zip64Eocd.writeUInt32LE(0, 16);
  zip64Eocd.writeUInt32LE(0, 20);
  zip64Eocd.writeBigUInt64LE(1n, 24); // entries on this disk
  zip64Eocd.writeBigUInt64LE(1n, 32); // total entries
  zip64Eocd.writeBigUInt64LE(BigInt(centralEntry.length), 40);
  zip64Eocd.writeBigUInt64LE(BigInt(centralDirOffset), 48);
  const zip64EocdOffset = centralDirOffset + centralEntry.length;

  const zip64Locator = Buffer.alloc(20);
  zip64Locator.writeUInt32LE(0x07064b50, 0);
  zip64Locator.writeUInt32LE(0, 4);
  zip64Locator.writeBigUInt64LE(BigInt(zip64EocdOffset), 8);
  zip64Locator.writeUInt32LE(1, 16);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(0xffff, 8); // ZIP64 sentinel: entries on this disk
  eocd.writeUInt16LE(0xffff, 10); // ZIP64 sentinel: total entries
  eocd.writeUInt32LE(0xffffffff, 12); // ZIP64 sentinel: central directory size
  eocd.writeUInt32LE(0xffffffff, 16); // ZIP64 sentinel: central directory offset
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localEntry, centralEntry, zip64Eocd, zip64Locator, eocd]);
}

const GOOD_DESCRIPTION =
  'One coach, many instruments. Band Coach listens through your microphone or a MIDI keyboard.';

function manifestXml({
  name = 'HeadlessMode.BandCoach',
  publisher = 'CN=B3DFE3DD-1543-4558-9C3F-7870BA69C771',
  version = '1.3.0.0',
  publisherDisplayName = 'Headless Mode',
  description = GOOD_DESCRIPTION,
} = {}) {
  return `<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10">
  <Identity Name="${name}"
    ProcessorArchitecture="x64"
    Publisher='${publisher}'
    Version="${version}" />
  <Properties>
    <PublisherDisplayName>${publisherDisplayName}</PublisherDisplayName>
    <DisplayName>Band Coach</DisplayName>
    <Description>${description}</Description>
  </Properties>
</Package>
`;
}

let dir;

test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'verify-appx-test-'));
});

test.afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeFixture(name, xml) {
  const appxPath = join(dir, name);
  writeFileSync(appxPath, buildAppxFixture(xml));
  return appxPath;
}

test('a manifest with the correct version, real identity and a clean description passes', () => {
  const appxPath = writeFixture('good.appx', manifestXml());
  const result = verifyAppx(appxPath, { rootVersion: '1.3.0' });
  assert.equal(result.name, 'HeadlessMode.BandCoach');
  assert.equal(result.publisher, 'CN=B3DFE3DD-1543-4558-9C3F-7870BA69C771');
  assert.equal(result.publisherDisplayName, 'Headless Mode');
  assert.equal(result.version, '1.3.0.0');
  assert.equal(result.description, GOOD_DESCRIPTION);
});

test('a ZIP64 archive (the real electron-builder appx shape) is still read correctly', () => {
  const appxPath = join(dir, 'zip64.appx');
  writeFileSync(appxPath, buildZip64AppxFixture(manifestXml()));
  const result = verifyAppx(appxPath, { rootVersion: '1.3.0' });
  assert.equal(result.name, 'HeadlessMode.BandCoach');
  assert.equal(result.publisher, 'CN=B3DFE3DD-1543-4558-9C3F-7870BA69C771');
  assert.equal(result.publisherDisplayName, 'Headless Mode');
  assert.equal(result.version, '1.3.0.0');
  assert.equal(result.description, GOOD_DESCRIPTION);
});

test('a version that was never stamped from the app version fails (the 0.1.0.0 defect)', () => {
  const appxPath = writeFixture('bad-version.appx', manifestXml({ version: '0.1.0.0' }));
  assert.throws(
    () => verifyAppx(appxPath, { rootVersion: '1.3.0' }),
    /version/i,
  );
});

test('a placeholder Identity/Name fails', () => {
  const appxPath = writeFixture(
    'placeholder-name.appx',
    manifestXml({ name: 'PLACEHOLDER.BandCoach' }),
  );
  assert.throws(
    () => verifyAppx(appxPath, { rootVersion: '1.3.0' }),
    /placeholder/i,
  );
});

test('a placeholder Identity/Publisher fails', () => {
  const appxPath = writeFixture(
    'placeholder-publisher.appx',
    manifestXml({ publisher: 'CN=PLACEHOLDER' }),
  );
  assert.throws(
    () => verifyAppx(appxPath, { rootVersion: '1.3.0' }),
    /placeholder/i,
  );
});

test('a placeholder PublisherDisplayName fails', () => {
  const appxPath = writeFixture(
    'placeholder-display-name.appx',
    manifestXml({ publisherDisplayName: 'PLACEHOLDER PUBLISHER' }),
  );
  assert.throws(
    () => verifyAppx(appxPath, { rootVersion: '1.3.0' }),
    /placeholder/i,
  );
});

test('a description carrying maintainer jargon fails (the PR #30 defect)', () => {
  const appxPath = writeFixture(
    'jargon-description.appx',
    manifestXml({
      description:
        'Thin Electron desktop shell that packages the built band-coach.html as a Windows Store MSIX (appx).',
    }),
  );
  assert.throws(
    () => verifyAppx(appxPath, { rootVersion: '1.3.0' }),
    /jargon/i,
  );
});

test('a missing Description fails', () => {
  const xml = manifestXml().replace(/<Description>.*<\/Description>/, '');
  const appxPath = writeFixture('no-description.appx', xml);
  assert.throws(
    () => verifyAppx(appxPath, { rootVersion: '1.3.0' }),
    /description/i,
  );
});

test('an appx with no AppxManifest.xml inside fails with a clear message', () => {
  const nameBuf = Buffer.from('SomethingElse.txt', 'ascii');
  const dataBuf = Buffer.from('not a manifest', 'utf8');
  const crc = crc32(dataBuf);
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(0, 8);
  localHeader.writeUInt16LE(0, 10);
  localHeader.writeUInt16LE(0, 12);
  localHeader.writeUInt32LE(crc, 14);
  localHeader.writeUInt32LE(dataBuf.length, 18);
  localHeader.writeUInt32LE(dataBuf.length, 22);
  localHeader.writeUInt16LE(nameBuf.length, 26);
  localHeader.writeUInt16LE(0, 28);
  const localEntry = Buffer.concat([localHeader, nameBuf, dataBuf]);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(0, 8);
  centralHeader.writeUInt16LE(0, 10);
  centralHeader.writeUInt16LE(0, 12);
  centralHeader.writeUInt16LE(0, 14);
  centralHeader.writeUInt32LE(crc, 16);
  centralHeader.writeUInt32LE(dataBuf.length, 20);
  centralHeader.writeUInt32LE(dataBuf.length, 24);
  centralHeader.writeUInt16LE(nameBuf.length, 28);
  centralHeader.writeUInt16LE(0, 30);
  centralHeader.writeUInt16LE(0, 32);
  centralHeader.writeUInt16LE(0, 34);
  centralHeader.writeUInt16LE(0, 36);
  centralHeader.writeUInt32LE(0, 38);
  centralHeader.writeUInt32LE(0, 42);
  const centralEntry = Buffer.concat([centralHeader, nameBuf]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralEntry.length, 12);
  eocd.writeUInt32LE(localEntry.length, 16);
  eocd.writeUInt16LE(0, 20);

  const appxPath = join(dir, 'no-manifest.appx');
  writeFileSync(appxPath, Buffer.concat([localEntry, centralEntry, eocd]));

  assert.throws(
    () => verifyAppx(appxPath, { rootVersion: '1.3.0' }),
    /AppxManifest\.xml/,
  );
});
