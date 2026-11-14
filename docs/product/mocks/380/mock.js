// #380 mocks: picks the state from ?s=a|b|c|d, injects the icon sprite, and for state d scrolls the
// body so the focused cell sits inside the band the keyboard leaves (layout height unchanged, lesson 16).
const sprite = `
<svg xmlns="http://www.w3.org/2000/svg" style="display:none">
  <symbol id="back" viewBox="0 0 24 24"><path d="M15 4.5 7.5 12l7.5 7.5"/></symbol>
  <symbol id="check" viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></symbol>
  <symbol id="play" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></symbol>
  <symbol id="history" viewBox="0 0 24 24"><path d="M4 20h16M7 16v-3M11 16V9M15 16v-5M19 16V5"/></symbol>
  <symbol id="replace" viewBox="0 0 24 24"><path d="M5 8h13l-3.5-3.5M19 16H6l3.5 3.5"/></symbol>
  <symbol id="later" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></symbol>
  <symbol id="timer" viewBox="0 0 24 24"><circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V10M9.5 3h5"/></symbol>
  <symbol id="dots" viewBox="0 0 24 24"><circle cx="12" cy="5.5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="18.5" r="1.6"/></symbol>
  <symbol id="dotsh" viewBox="0 0 24 24"><circle cx="5.5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18.5" cy="12" r="1.6"/></symbol>
  <symbol id="chev" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></symbol>
</svg>`;
document.body.insertAdjacentHTML('afterbegin', sprite);
const state = new URLSearchParams(location.search).get('s') || 'a';
document.body.dataset.s = state;
if (state === 'd') {
  const screen = document.querySelector('.state--d');
  const body = screen.querySelector('.body');
  const focus = screen.querySelector('[data-focus-block]');
  const kb = screen.querySelector('.kb');
  // The visible band ends at the keyboard's accessory bar; keep the focused block 12px above it.
  const bandBottom = kb.getBoundingClientRect().top - 44 - 12;
  const overshoot = focus.getBoundingClientRect().bottom - bandBottom;
  if (overshoot > 0) body.firstElementChild.style.marginTop = `${-overshoot}px`;
}
