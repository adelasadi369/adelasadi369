import { describe, expect, it } from 'vitest';
import { applyPatch, PatchError } from '../src/core/jsonpatch';

describe('RFC 6902 JSON Patch', () => {
  const doc = { a: { b: 1, 'c/d': 2, 'e~f': 3 }, list: [1, 2, 3] };

  it('add / replace / remove / move / copy / test', () => {
    const out = applyPatch(doc, [
      { op: 'add', path: '/a/x', value: 9 },
      { op: 'replace', path: '/a/b', value: 5 },
      { op: 'remove', path: '/a/c~1d' },
      { op: 'add', path: '/list/1', value: 7 },
      { op: 'add', path: '/list/-', value: 8 },
      { op: 'move', from: '/a/e~0f', path: '/moved' },
      { op: 'copy', from: '/a/b', path: '/copied' },
      { op: 'test', path: '/copied', value: 5 },
    ]);
    expect(out).toEqual({ a: { b: 5, x: 9 }, list: [1, 7, 2, 3, 8], moved: 3, copied: 5 });
    expect(doc.a.b).toBe(1); // input untouched
  });

  it('is atomic: a failing op throws and reports its index', () => {
    expect(() =>
      applyPatch(doc, [
        { op: 'replace', path: '/a/b', value: 2 },
        { op: 'remove', path: '/nope' },
      ]),
    ).toThrow(PatchError);
    try {
      applyPatch(doc, [{ op: 'test', path: '/a/b', value: 99 }]);
    } catch (e) {
      expect((e as PatchError).index).toBe(0);
    }
  });

  it('rejects bad pointers and moving into a child', () => {
    expect(() => applyPatch(doc, [{ op: 'add', path: 'a', value: 1 }])).toThrow();
    expect(() => applyPatch(doc, [{ op: 'move', from: '/a', path: '/a/b' }])).toThrow();
    expect(() => applyPatch(doc, [{ op: 'add', path: '/list/9', value: 1 }])).toThrow();
  });
});
