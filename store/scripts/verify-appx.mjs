// Reads AppxManifest.xml out of a built .appx (an .appx is a plain ZIP) and
// refuses (throws) when what actually landed in it does not match what was
// supposed to ship. apply-identity.mjs / --require-identity stop a build
// from running with placeholder identity or an unstamped version; this
// script is the check on the OTHER side of that -- what the packager
// actually wrote into the artifact -- because both of the two defects that
// have reached a real shipped .appx so far (Version="0.1.0.0" in v1.2.0,
// maintainer copy in <Description> before PR #30) came from electron-builder
// itself doing something the source config didn't ask for, not from a
// missing input. Wired into .github/workflows/store-package.yml AFTER
// packaging and BEFORE the artifact upload, so a bad manifest fails the
// run instead of producing an artifact that looks finished.
//
// No new dependency: `unzip` is not confirmed present on the windows-latest
// runner this has to run on (actions/runner-images' Windows2022 tool list
// has 7zip, not unzip), so this reads the ZIP central directory and inflates
// the one entry it needs with node:zlib -- the same approach as a real
// unzip, just written by hand for the one file this ever needs to read.
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readRootPackageVersion, computeAppxVersion } from './apply-identity.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const STORE_ROOT = dirname(here);
const REPO_ROOT = dirname(STORE_ROOT);

const DEFAULT_ELECTRON_BUILDER_CONFIG = join(STORE_ROOT, 'electron-builder.json');
const DEFAULT_JARGON_SOURCE = join(REPO_ROOT, 'tests', 'unit', 'store-listing-description.test.mjs');

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_EOCD_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const ZIP64_EXTRA_FIELD_ID = 0x0001;
const ZIP64_SENTINEL_32 = 0xffffffff;
const ZIP64_SENTINEL_16 = 0xffff;
const MANIFEST_ENTRY_NAME = 'AppxManifest.xml';

// Scans backward for the End Of Central Directory record. A ZIP comment (up
// to 65535 bytes) can follow it, so the signature isn't necessarily at a
// fixed offset from the end of the file -- this appx never sets a comment,
// but a hand-rolled reader that assumed otherwise would fail confusingly
// the day something did.
function findEndOfCentralDirectory(buf) {
  const maxCommentLength = 65535;
  const searchStart = Math.max(0, buf.length - 22 - maxCommentLength);
  for (let i = buf.length - 22; i >= searchStart; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) {
      return i;
    }
  }
  return -1;
}

// electron-builder's appx writer (the real `Band Coach 1.3.0.0.appx`, 79
// entries) always writes ZIP64: the classic EOCD's entry count/size/offset
// are all the 0xffffffff/0xffff sentinel, a ZIP64 EOCD locator sits
// immediately before the classic EOCD, and it points at a ZIP64 EOCD record
// carrying the real 64-bit count/size/offset. A reader that takes the
// sentinel literally (as this script originally did) fails on every real
// package while still passing against a small hand-built ZIP -- which is
// exactly the shape of ZIP the tests must build to catch this. See
// https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT section 4.3.15.
function locateCentralDirectory(buf, eocdOffset) {
  const classicTotalEntries = buf.readUInt16LE(eocdOffset + 10);
  const classicCdSize = buf.readUInt32LE(eocdOffset + 12);
  const classicCdOffset = buf.readUInt32LE(eocdOffset + 16);

  const needsZip64 =
    classicTotalEntries === ZIP64_SENTINEL_16 ||
    classicCdSize === ZIP64_SENTINEL_32 ||
    classicCdOffset === ZIP64_SENTINEL_32;

  if (!needsZip64) {
    return { centralDirOffset: classicCdOffset, totalEntries: classicTotalEntries };
  }

  const locatorOffset = eocdOffset - 20;
  if (locatorOffset < 0 || buf.readUInt32LE(locatorOffset) !== ZIP64_EOCD_LOCATOR_SIGNATURE) {
    throw new Error(
      'the classic end-of-central-directory record uses the ZIP64 sentinel value but no ZIP64 ' +
        'end-of-central-directory locator was found immediately before it',
    );
  }
  const zip64EocdOffset = Number(buf.readBigUInt64LE(locatorOffset + 8));

  if (buf.readUInt32LE(zip64EocdOffset) !== ZIP64_EOCD_SIGNATURE) {
    throw new Error('the ZIP64 end-of-central-directory locator points at a record with the wrong signature');
  }
  const totalEntries = Number(buf.readBigUInt64LE(zip64EocdOffset + 32));
  const centralDirOffset = Number(buf.readBigUInt64LE(zip64EocdOffset + 48));
  return { centralDirOffset, totalEntries };
}

// A central directory entry that hit the ZIP64 sentinel in one of
// uncompressed size / compressed size / local header offset / disk number
// carries the real 64-bit values in a "Zip64 extended information" extra
// field (header id 0x0001) -- present ONLY for the fields that were actually
// sentinel, in that fixed order. AppxManifest.xml itself is a few hundred
// bytes, but electron-builder's writer stamps the sentinel on every entry in
// a ZIP64 archive regardless of that entry's own size, so this override has
// to run for every entry, not just ones that look individually huge.
function readZip64ExtraOverrides(buf, extraStart, extraLength, { uncompressedSize, compressedSize, localHeaderOffset }) {
  let cursor = extraStart;
  const extraEnd = extraStart + extraLength;
  while (cursor + 4 <= extraEnd) {
    const fieldId = buf.readUInt16LE(cursor);
    const fieldSize = buf.readUInt16LE(cursor + 2);
    if (fieldId === ZIP64_EXTRA_FIELD_ID) {
      let p = cursor + 4;
      if (uncompressedSize === ZIP64_SENTINEL_32) {
        uncompressedSize = Number(buf.readBigUInt64LE(p));
        p += 8;
      }
      if (compressedSize === ZIP64_SENTINEL_32) {
        compressedSize = Number(buf.readBigUInt64LE(p));
        p += 8;
      }
      if (localHeaderOffset === ZIP64_SENTINEL_32) {
        localHeaderOffset = Number(buf.readBigUInt64LE(p));
        p += 8;
      }
      break;
    }
    cursor += 4 + fieldSize;
  }
  return { uncompressedSize, compressedSize, localHeaderOffset };
}

function readZipEntry(appxPath, entryName) {
  const buf = readFileSync(appxPath);
  const eocdOffset = findEndOfCentralDirectory(buf);
  if (eocdOffset === -1) {
    throw new Error(`${appxPath} does not look like a ZIP file (no end-of-central-directory record found)`);
  }
  const { centralDirOffset, totalEntries } = locateCentralDirectory(buf, eocdOffset);

  let cursor = centralDirOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (buf.readUInt32LE(cursor) !== CENTRAL_DIR_SIGNATURE) {
      throw new Error(`${appxPath}'s central directory is malformed (bad signature at entry ${i})`);
    }
    const compressionMethod = buf.readUInt16LE(cursor + 10);
    let compressedSize = buf.readUInt32LE(cursor + 20);
    let uncompressedSize = buf.readUInt32LE(cursor + 24);
    const fileNameLength = buf.readUInt16LE(cursor + 28);
    const extraFieldLength = buf.readUInt16LE(cursor + 30);
    const fileCommentLength = buf.readUInt16LE(cursor + 32);
    let localHeaderOffset = buf.readUInt32LE(cursor + 42);
    const fileName = buf.toString('ascii', cursor + 46, cursor + 46 + fileNameLength);

    if (
      compressedSize === ZIP64_SENTINEL_32 ||
      uncompressedSize === ZIP64_SENTINEL_32 ||
      localHeaderOffset === ZIP64_SENTINEL_32
    ) {
      ({ compressedSize, uncompressedSize, localHeaderOffset } = readZip64ExtraOverrides(
        buf,
        cursor + 46 + fileNameLength,
        extraFieldLength,
        { compressedSize, uncompressedSize, localHeaderOffset },
      ));
    }

    if (fileName === entryName) {
      return extractEntryData(buf, localHeaderOffset, compressionMethod, compressedSize);
    }

    cursor += 46 + fileNameLength + extraFieldLength + fileCommentLength;
  }
  return null;
}

function extractEntryData(buf, localHeaderOffset, compressionMethod, compressedSize) {
  if (buf.readUInt32LE(localHeaderOffset) !== LOCAL_HEADER_SIGNATURE) {
    throw new Error('malformed ZIP local file header');
  }
  const fileNameLength = buf.readUInt16LE(localHeaderOffset + 26);
  const extraFieldLength = buf.readUInt16LE(localHeaderOffset + 28);
  const dataStart = localHeaderOffset + 30 + fileNameLength + extraFieldLength;
  const compressed = buf.subarray(dataStart, dataStart + compressedSize);

  if (compressionMethod === 0) {
    return compressed; // stored, no compression
  }
  if (compressionMethod === 8) {
    return inflateRawSync(compressed); // deflate
  }
  throw new Error(`unsupported ZIP compression method ${compressionMethod} for the manifest entry`);
}

function extractAttr(tag, attrName) {
  const match = tag.match(new RegExp(`${attrName}\\s*=\\s*(["'])(.*?)\\1`));
  return match ? match[2] : null;
}

export function parseManifest(xml) {
  const identityMatch = xml.match(/<Identity\b[^>]*\/?>/s);
  const identityTag = identityMatch ? identityMatch[0] : '';
  const publisherDisplayNameMatch = xml.match(/<PublisherDisplayName>([\s\S]*?)<\/PublisherDisplayName>/);
  const descriptionMatch = xml.match(/<Description>([\s\S]*?)<\/Description>/);
  return {
    name: extractAttr(identityTag, 'Name'),
    publisher: extractAttr(identityTag, 'Publisher'),
    version: extractAttr(identityTag, 'Version'),
    publisherDisplayName: publisherDisplayNameMatch ? publisherDisplayNameMatch[1].trim() : null,
    description: descriptionMatch ? descriptionMatch[1].trim() : null,
  };
}

// The maintainer-jargon word list lives in exactly one place --
// tests/unit/store-listing-description.test.mjs -- so this reads it back out
// of that file's source rather than keeping a second copy that can drift out
// of sync with the one the description test actually enforces.
export function readMaintainerJargonList(jargonSourcePath = DEFAULT_JARGON_SOURCE) {
  const source = readFileSync(jargonSourcePath, 'utf8');
  const listMatch = source.match(/const maintainerJargon = \[([\s\S]*?)\];/);
  if (!listMatch) {
    throw new Error(`could not find the maintainerJargon list in ${jargonSourcePath}; has it been renamed?`);
  }
  const terms = [...listMatch[1].matchAll(/'([^']*)'/g)].map(m => m[1]);
  if (terms.length === 0) {
    throw new Error(`found the maintainerJargon list in ${jargonSourcePath} but it is empty`);
  }
  return terms;
}

export function verifyAppx(appxPath, {
  rootVersion = readRootPackageVersion(),
  electronBuilderConfigPath = DEFAULT_ELECTRON_BUILDER_CONFIG,
  jargonSourcePath = DEFAULT_JARGON_SOURCE,
} = {}) {
  const manifestXmlBuf = readZipEntry(appxPath, MANIFEST_ENTRY_NAME);
  if (manifestXmlBuf === null) {
    throw new Error(`${MANIFEST_ENTRY_NAME} not found inside ${appxPath} -- is this a real .appx?`);
  }
  const manifest = parseManifest(manifestXmlBuf.toString('utf8'));

  const expectedVersion = computeAppxVersion(rootVersion);
  if (manifest.version !== expectedVersion) {
    throw new Error(
      `appx manifest Identity/Version is "${manifest.version}" but the app's release version ` +
        `(${rootVersion}) requires "${expectedVersion}" -- the packaged manifest was not stamped ` +
        `from the app's own version (this is the defect that shipped v1.2.0 as 0.1.0.0)`,
    );
  }

  const placeholders = JSON.parse(readFileSync(electronBuilderConfigPath, 'utf8')).appx;

  if (!manifest.name || manifest.name.trim() === '') {
    throw new Error('appx manifest Identity/Name is empty');
  }
  if (manifest.name === placeholders.identityName) {
    throw new Error(
      `appx manifest Identity/Name is still the placeholder "${placeholders.identityName}" from ` +
        'store/electron-builder.json -- BC_IDENTITY_NAME was not applied before packaging',
    );
  }

  if (!manifest.publisher || manifest.publisher.trim() === '') {
    throw new Error('appx manifest Identity/Publisher is empty');
  }
  if (manifest.publisher === placeholders.publisher) {
    throw new Error(
      `appx manifest Identity/Publisher is still the placeholder "${placeholders.publisher}" from ` +
        'store/electron-builder.json -- BC_PUBLISHER was not applied before packaging',
    );
  }

  if (!manifest.publisherDisplayName || manifest.publisherDisplayName.trim() === '') {
    throw new Error('appx manifest PublisherDisplayName is empty');
  }
  if (manifest.publisherDisplayName === placeholders.publisherDisplayName) {
    throw new Error(
      `appx manifest PublisherDisplayName is still the placeholder "${placeholders.publisherDisplayName}" ` +
        'from store/electron-builder.json -- BC_PUBLISHER_DISPLAY_NAME was not applied before packaging',
    );
  }

  if (!manifest.description || manifest.description.trim() === '') {
    throw new Error('appx manifest Description is empty -- the Store listing needs shopper-facing copy');
  }
  const jargon = readMaintainerJargonList(jargonSourcePath);
  const lowered = manifest.description.toLowerCase();
  const foundJargon = jargon.filter(term => lowered.includes(term));
  if (foundJargon.length > 0) {
    throw new Error(
      `appx manifest Description is published to Store shoppers but contains maintainer jargon: ` +
        `${foundJargon.join(', ')} (this is the defect PR #30 fixed)`,
    );
  }

  return manifest;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const appxPath = process.argv[2];
  if (!appxPath) {
    console.error('usage: node verify-appx.mjs <path-to-appx>');
    process.exit(1);
  }
  try {
    const manifest = verifyAppx(appxPath);
    console.log(`verified ${appxPath}:`);
    console.log(`  Identity/Name: ${manifest.name}`);
    console.log(`  Identity/Publisher: ${manifest.publisher}`);
    console.log(`  Identity/Version: ${manifest.version}`);
    console.log(`  PublisherDisplayName: ${manifest.publisherDisplayName}`);
    console.log(`  Description: ${manifest.description}`);
  } catch (err) {
    console.error(`appx verification failed: ${err.message}`);
    process.exit(1);
  }
}
