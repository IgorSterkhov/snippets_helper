import { choiceKey, choiceLabel } from '../../src/ai/choiceDisplay';

describe('mobile AI choice display helpers', () => {
  test('renders server-side telegram choice shape', () => {
    const choice = { uuid: 'note-1', label: 'Kylin deployment notes' };

    expect(choiceKey(choice, 0)).toBe('note-1');
    expect(choiceLabel(choice)).toBe('Kylin deployment notes');
  });

  test('renders client-side command dispatcher choice shape', () => {
    const choice = { item_uuid: 'snippet-1', title: 'kylin_restart' };

    expect(choiceKey(choice, 0)).toBe('snippet-1');
    expect(choiceLabel(choice)).toBe('kylin_restart');
  });
});
