import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseXml, element, elements, text, childText, attr } from '../../src/song/xml-lite.js';

test('parses a simple element tree with attributes and text', () => {
  const root = parseXml('<a x="1"><b>hello</b><b>world</b></a>');
  assert.equal(root.name, 'a');
  assert.equal(attr(root, 'x'), '1');
  const bs = elements(root, 'b');
  assert.equal(bs.length, 2);
  assert.equal(text(bs[0]), 'hello');
  assert.equal(childText(root, 'b'), 'hello');
});
test('decodes named and numeric entities', () => {
  const root = parseXml('<a>&amp;&lt;&gt;&quot;&apos;&#65;&#x42;</a>');
  assert.equal(text(root), '&<>"\'AB');
});
test('rejects an unknown entity', () => {
  assert.throws(() => parseXml('<a>&bogus;</a>'), /unknown entity/);
});
test('skips comments, processing instructions and DOCTYPE', () => {
  const root = parseXml('<?xml version="1.0"?>\n<!DOCTYPE a [ <!ENTITY x "y"> ]>\n<a><!-- a comment --><b/></a>');
  assert.equal(root.name, 'a');
  assert.equal(element(root, 'b').name, 'b');
});
test('reads CDATA as literal text', () => {
  const root = parseXml('<a><![CDATA[<not a tag> & stuff]]></a>');
  assert.equal(text(root), '<not a tag> & stuff');
});
test('self-closing elements have no children', () => {
  const root = parseXml('<a><b/></a>');
  assert.deepEqual(element(root, 'b').children, []);
});
test('throws a plain message on mismatched close tags', () => {
  assert.throws(() => parseXml('<a><b></c></a>'), /mismatched closing tag/);
});
test('throws on unclosed tags', () => {
  assert.throws(() => parseXml('<a><b>'), /unclosed tag/);
});
test('throws when nesting exceeds the depth limit', () => {
  let xml = '';
  for (let i = 0; i < 10; i += 1) xml += '<a>';
  for (let i = 0; i < 10; i += 1) xml += '</a>';
  assert.throws(() => parseXml(xml, { maxDepth: 5 }), /nesting exceeds/);
});
test('throws when input exceeds the length limit', () => {
  assert.throws(() => parseXml('<a/>', { maxLength: 2 }), /too large/);
});
test('rejects input with no root element', () => {
  assert.throws(() => parseXml('   '), /expected a root element/);
});
