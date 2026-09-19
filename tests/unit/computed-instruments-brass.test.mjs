import test from 'node:test';
import assert from 'node:assert/strict';
import { harmonicPitch, fingeringsForValves, fingeringsForSlide, PRESETS } from '../../src/instruments/how/brass.js';

test('harmonicPitch: partial 2 is an octave above the fundamental', () => {
  assert.equal(harmonicPitch(48, 2), 60);
});

test('harmonicPitch: partial 4 is two octaves above the fundamental', () => {
  assert.equal(harmonicPitch(48, 4), 72);
});

test('trumpet: written C4 is open', () => {
  const r = fingeringsForValves(60, PRESETS['trumpet-cornet']);
  assert.equal(r.standard.label, 'open');
});

test('trumpet: written D4 is 1-3', () => {
  const r = fingeringsForValves(62, PRESETS['trumpet-cornet']);
  assert.equal(r.standard.label, '1-3');
});

test('trumpet: written E4 is 1-2', () => {
  const r = fingeringsForValves(64, PRESETS['trumpet-cornet']);
  assert.equal(r.standard.label, '1-2');
});

test('trumpet: written F4 is 1', () => {
  const r = fingeringsForValves(65, PRESETS['trumpet-cornet']);
  assert.equal(r.standard.label, '1');
});

test('trumpet: written G4 is open', () => {
  const r = fingeringsForValves(67, PRESETS['trumpet-cornet']);
  assert.equal(r.standard.label, 'open');
});

test('trumpet: written A4 is 1-2', () => {
  const r = fingeringsForValves(69, PRESETS['trumpet-cornet']);
  assert.equal(r.standard.label, '1-2');
});

test('trumpet: written B4 is 2', () => {
  const r = fingeringsForValves(71, PRESETS['trumpet-cornet']);
  assert.equal(r.standard.label, '2');
});

test('trumpet: written C5 is open', () => {
  const r = fingeringsForValves(72, PRESETS['trumpet-cornet']);
  assert.equal(r.standard.label, 'open');
});

test('trumpet: 3 alone is offered only as an alternate to 1-2, never standard', () => {
  const r = fingeringsForValves(64, PRESETS['trumpet-cornet']);
  assert.equal(r.standard.label, '1-2');
  assert.ok(r.alternates.some(a => a.label === '3'));
});

test('trombone: Bb2 is 1st position', () => {
  const r = fingeringsForSlide(46, PRESETS.trombone);
  assert.equal(r.standard.label, '1');
});

test('trombone: F3 is 1st position', () => {
  const r = fingeringsForSlide(53, PRESETS.trombone);
  assert.equal(r.standard.label, '1');
});

test('trombone: C3 is 6th position', () => {
  const r = fingeringsForSlide(48, PRESETS.trombone);
  assert.equal(r.standard.label, '6');
});

test('trombone: E3 is 2nd position', () => {
  const r = fingeringsForSlide(52, PRESETS.trombone);
  assert.equal(r.standard.label, '2');
});

test('4-valve euphonium: 4th valve substitutes for the sharp 1-3 combo', () => {
  const r = fingeringsForValves(48, PRESETS['euphonium-4-valve']); // partial 3 (53) - drop 5 = 48
  assert.equal(r.standard.label, '4');
  assert.ok(r.alternates.some(a => a.label === '1-3'));
});

test('3-valve euphonium (no 4th valve) falls back to 1-3 for the same pitch', () => {
  const r = fingeringsForValves(48, PRESETS.euphonium);
  assert.equal(r.standard.label, '1-3');
  assert.equal(r.standard.sharp, true);
});

test('sharp combos are flagged', () => {
  const r = fingeringsForValves(62, PRESETS['trumpet-cornet']); // D4 = 1-3
  assert.equal(r.standard.sharp, true);
});

test('a pitch with no reachable fingering reports empty and needsCheck', () => {
  const r = fingeringsForValves(1, PRESETS['trumpet-cornet']);
  assert.equal(r.standard, null);
  assert.equal(r.needsCheck, true);
});
