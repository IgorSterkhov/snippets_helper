export function choiceLabel(choice = {}) {
  return (
    choice.label
    || choice.title
    || choice.name
    || choice.uuid
    || choice.item_uuid
    || 'Без названия'
  );
}

export function choiceKey(choice = {}, index = 0) {
  return String(choice.item_uuid || choice.uuid || choiceLabel(choice) || index);
}
