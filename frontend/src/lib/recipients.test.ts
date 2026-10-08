import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addressesOf, recipientsProblem } from './recipients.ts';

describe('addressesOf', () => {
  it('splits on commas, trims, and drops empty entries', () => {
    assert.deepEqual(addressesOf(' chs-techs@district.example, ,lead@district.example, '), ['chs-techs@district.example', 'lead@district.example']);
    assert.deepEqual(addressesOf('  '), []);
  });
});

describe('recipientsProblem', () => {
  it('takes bare addresses, and an empty list (the default recipients)', () => {
    assert.equal(recipientsProblem('chs-techs@district.example, lead@district.example'), null);
    assert.equal(recipientsProblem(''), null);
  });

  it('names each entry that is not a bare address, as the server does for NOTIFY_TO', () => {
    assert.equal(
      recipientsProblem('techs@district.example, not-an-address, a@b'),
      'Not an address: "not-an-address", "a@b". Use bare addresses like techs@district.example, comma-separated.',
    );
    assert.match(recipientsProblem('Techs <techs@district.example>') ?? '', /^Not an address: "Techs <techs@district\.example>"/);
    assert.match(recipientsProblem('techs@district.example; lead@district.example') ?? '', /^Not an address/);
  });

  it('refuses a list too long to store', () => {
    const long = Array.from({ length: 60 }, (_, i) => `technician-${i}@district.example`).join(', ');
    assert.match(recipientsProblem(long) ?? '', /Too long to store \(1000 characters at most\)/);
  });
});
