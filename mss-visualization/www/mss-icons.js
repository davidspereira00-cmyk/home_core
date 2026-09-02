export function mssIcon(name, size = 18) {
  const icons = {
    add: '/local/mss/icons/circle-plus-svgrepo-com.svg',
    close: '/local/mss/icons/xmark-svgrepo-com.svg',
    more: '/local/mss/icons/dots-vertical-svgrepo-com.svg',
    minus: '/local/mss/icons/minus-svgrepo-com.svg',
    trash: '/local/mss/icons/trash-svgrepo-com.svg',
    copy: '/local/mss/icons/clone-svgrepo-com.svg',
    plus: '/local/mss/icons/plus-svgrepo-com.svg',
    fit: '/local/mss/icons/minimize-svgrepo-com.svg',
    fullscreen: '/local/mss/icons/maximize-svgrepo-com.svg',
    edit: '/local/mss/icons/pen-svgrepo-com.svg',
    flipBack: '/local/mss/icons/flip-backward-svgrepo-com.svg',
  };

  const src = icons[name];

  if (!src) {
    return '';
  }

  return `
    <img
      class="mss-action-icon"
      src="${src}"
      width="${size}"
      height="${size}"
      alt=""
      aria-hidden="true">
  `;
}
