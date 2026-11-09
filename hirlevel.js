'use strict';
/*
 * Confirms or ends a newsletter subscription. The secret stays in the #fragment (#c=… or #u=…), so it
 * never reaches a server log, and it takes a button press: mail scanners open links, but they don't
 * press buttons.
 */
const FN = 'https://rudnmzhfgnynlmjdrwoy.supabase.co/functions/v1/newsletter';
const [kind, token] = location.hash.slice(1).split('=');
const leaving = kind === 'u';
const title = document.getElementById('title');
const message = document.getElementById('message');
const button = document.getElementById('go');
/** The final word: a text, and maybe a link to go on with. */
const done = (text, link) => {
  message.textContent = text + (link ? ' ' : '');
  if (link) {
    const a = document.createElement('a');
    a.href = link.href;
    a.textContent = link.text;
    message.append(a, '.');
  }
  button.classList.add('hidden');
};
// Whoever can't use the link can still get off the list by writing to us.
const support = { href: 'tamogatas', text: 'Írj nekünk, és leiratkoztatunk' };
const signUp = { href: '/#hirlevel', text: 'Iratkozz fel újra a kezdőlapon' };

if (leaving) {
  title.textContent = 'Leiratkozás a hírlevélről';
  message.textContent = 'Ha leiratkozol, több hírlevelet nem küldünk erre a címre.';
  button.textContent = 'Leiratkozom';
}
if (!/^[0-9a-f]{64}$/.test(token ?? '') || (kind !== 'c' && kind !== 'u')) {
  done('Ez a link nem teljes vagy elírták. Nyisd meg újra a levélből, vagy másold be az egészet.', leaving ? support : signUp);
}

button.addEventListener('click', async () => {
  button.disabled = true;
  let status;
  try {
    const body = leaving ? { unsubscribe: token } : { confirm: token };
    const res = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    ({ status } = await res.json());
  } catch {
    // No answer: the link may be fine, so the button stays for another try.
    message.textContent = 'Nem értük el a szervert. Van internet? Próbáld újra.';
    button.disabled = false;
    return;
  }
  if (status === 'confirmed') done('Köszönjük, feliratkoztál! Szólunk, amikor a Trippo elérhető.');
  else if (status === 'unsubscribed') done('Leiratkoztál. Több hírlevelet nem küldünk.');
  else if (leaving) done('Ez a leiratkozó link már nem érvényes.', support);
  else done('Ez a megerősítő link lejárt vagy már nem érvényes.', signUp);
});
