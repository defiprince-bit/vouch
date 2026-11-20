import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Ticket, type TicketProps } from '@/components/Ticket';

const root = resolve(import.meta.dirname, '..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

const base: TicketProps = {
  tag: 'Shared with you to verify',
  stamp: 'Sign',
  habit: 'Run three times this week',
  stake: '0.0002 BCH',
  deadline: 'Block 924000',
  verifier: 'Douglas',
  beneficiary: 'David',
  keepCopy: 'Coins come back.',
  breakCopy: 'Coins go to David.',
};

describe('Ticket party label', () => {
  it('defaults the party field to Verifier for staker, create, and status views', () => {
    const html = renderToStaticMarkup(createElement(Ticket, base));
    expect(html).toMatch(/<p class="field-label">Verifier<\/p>/);
    expect(html).toContain('Douglas');
    expect(html).not.toMatch(/<p class="field-label">Staker<\/p>/);
  });

  it('labels the staker, with their address, on the verifier’s ticket', () => {
    const html = renderToStaticMarkup(
      createElement(Ticket, {
        ...base,
        partyLabel: 'Staker',
        verifier: 'Your friend',
        verifierNote: 'bitcoincash:qzd9…z84z',
      }),
    );
    expect(html).toMatch(/<p class="field-label">Staker<\/p>/);
    expect(html).toContain('Your friend');
    expect(html).toContain('bitcoincash:qzd9…z84z');
    expect(html).not.toMatch(/<p class="field-label">Verifier<\/p>/);
    expect(html).not.toContain('Your friend (staker)');
  });
});

describe('verify-page ticket wiring', () => {
  const pledge = read('src/app/(app)/verify/VerifyPledge.tsx');
  const quorum = read('src/app/(app)/verify/VerifyQuorum.tsx');

  it('passes Staker / Your friend on both verify tickets, never “Your friend (staker)” under Verifier', () => {
    for (const src of [pledge, quorum]) {
      expect(src).toMatch(/partyLabel="Staker"/);
      expect(src).toMatch(/verifier="Your friend"/);
      expect(src).toMatch(/verifierNote=\{shortAddr\(stakerAddr\)\}/);
      expect(src).not.toMatch(/Your friend \(staker\)/);
    }
  });

  it('tells the verifier their signature is enough on v1.1, and that the staker already signed on older pledges', () => {
    expect(pledge).toMatch(/p\.verifierRefund/);
    expect(pledge).toMatch(/Your signature is all it needs/);
    expect(pledge).toMatch(/Their signature is already on this refund/);
    expect(quorum).toMatch(/p\.verifierRefund/);
    expect(quorum).toMatch(/The address was fixed when they locked it/);
    expect(quorum).toMatch(/Their own signature is already in this link/);
  });

  it('leaves Verifier as the default label on create, the pledge page, the wall, and the landing ticket', () => {
    const create = read('src/app/(app)/create/CreatePledgeForm.tsx');
    const status = read('src/app/(app)/pledges/PledgeStatus.tsx');
    const wall = read('src/app/(app)/wall/WallCard.tsx');
    const landing = read('src/app/(landing)/page.tsx');
    expect(create).not.toMatch(/partyLabel/);
    expect(status).not.toMatch(/partyLabel/);
    expect(wall).toMatch(/field-label">Verifier</);
    expect(landing).toMatch(/field-label">Verifiers</);
  });
});
