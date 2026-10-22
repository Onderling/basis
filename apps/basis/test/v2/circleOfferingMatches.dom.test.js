// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { renderOfferingMatches } from '../../web/v2/circleOfferingMatches.js';

const t = (k) => k;
function mount() { const el = document.createElement('div'); document.body.appendChild(el); return el; }

const matches = [
  { id: 'm1', label: 'Bert',    source: 'human' },
  { id: 'm2', label: 'Tuinbot', source: 'agent' },
  { id: 'm3', label: 'Sjoerd',  source: 'via-hop' },
];

describe('renderOfferingMatches', () => {
  it('renders one row per match with label + source badge', () => {
    const el = mount();
    renderOfferingMatches(el, { matches, t });
    const rowEls = el.querySelectorAll('.circle-offering-matches__row');
    expect(rowEls).toHaveLength(3);
    const human = el.querySelector('.circle-offering-matches__row[data-source=human]');
    expect(human.querySelector('.circle-offering-matches__label').textContent).toBe('Bert');
    expect(human.querySelector('.circle-offering-matches__badge').textContent).toBe('circle.offerings.source.human');
  });

  it('badges carry the source data attr and the translated source key', () => {
    const el = mount();
    renderOfferingMatches(el, { matches, t });
    const agent = el.querySelector('.circle-offering-matches__row[data-source=agent] .circle-offering-matches__badge');
    expect(agent.dataset.source).toBe('agent');
    expect(agent.textContent).toBe('circle.offerings.source.agent');
    const hop = el.querySelector('.circle-offering-matches__row[data-source=via-hop] .circle-offering-matches__badge');
    expect(hop.textContent).toBe('circle.offerings.source.via-hop');
  });

  it('shows the empty state when there are no matches', () => {
    const el = mount();
    renderOfferingMatches(el, { matches: [], t });
    expect(el.querySelectorAll('.circle-offering-matches__row')).toHaveLength(0);
    expect(el.querySelector('.circle-offering-matches__empty').textContent).toBe('circle.offerings.no_matches');
  });

  it('onBack fires from the back button', () => {
    const el = mount();
    const onBack = vi.fn();
    renderOfferingMatches(el, { matches, t, onBack });
    el.querySelector('.circle-offering-matches__back').click();
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe('renderOfferingMatches — inline under my ask', () => {
  it('names the offering and gives each match an Ask and a Skip, with no back button', () => {
    const el = mount();
    const onAsk = vi.fn(); const onSkip = vi.fn();
    renderOfferingMatches(el, { matches: [{ id: 'w1', label: '@bram', offering: 'bike repair' }], t, onAsk, onSkip });
    expect(el.querySelector('.circle-offering-matches__back')).toBeNull();
    expect(el.querySelector('.circle-offering-matches__offering').textContent).toBe('bike repair');
    el.querySelector('.circle-offering-matches__ask').click();
    el.querySelector('.circle-offering-matches__skip').click();
    expect(onAsk.mock.calls[0][0]).toMatchObject({ id: 'w1', label: '@bram' });
    expect(onSkip.mock.calls[0][0]).toMatchObject({ id: 'w1' });
  });
});
