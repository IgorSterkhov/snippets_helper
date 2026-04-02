export function createSearchBar(onInput) {
  const wrapper = document.createElement('div');
  wrapper.className = 'search-bar';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Search...';

  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      onInput(input.value);
    }, 300);
  });

  wrapper.appendChild(input);
  return wrapper;
}
