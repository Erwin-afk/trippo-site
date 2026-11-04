'use strict';
/*
 * Confirms or ends a newsletter subscription. The secret stays in the #fragment (#c=… or #u=…), so it
 * never reaches a server log, and it takes a button press: mail scanners open links, but they don't
 * press buttons.
 */
const FN = 'https://rudnmzhfgnynlmjdrwoy.supabase.co/functions/v1/newsletter';
const [kind, token] = location.hash.slice(1).split('=');
const title = document.getElementById('title');
const message = document.getElementById('message');
const button = document.getElementById('go');
const done = (text) => {
  message.textContent = text;
  button.classList.add('hidden');
};

if (!/^[0-9a-f]{64}$/.test(token ?? '') || (kind !== 'c' && kind !== 'u')) {
  done('Ez a link nem érvényes.');
} else if (kind === 'u') {
  title.textContent = 'Leiratkozás a hírlevélről';
  message.textContent = 'Ha leiratkozol, több hírlevelet nem küldünk erre a címre.';
  button.textContent = 'Leiratkozom';
}

button.addEventListener('click', async () => {
  button.disabled = true;
  try {
    const body = kind === 'u' ? { unsubscribe: token } : { confirm: token };
    const res = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const { status } = await res.json();
    if (status === 'confirmed') done('Köszönjük, feliratkoztál! Szólunk, amikor a Trippo elérhető.');
    else if (status === 'unsubscribed') done('Leiratkoztál. Több hírlevelet nem küldünk.');
    else throw new Error(status);
  } catch {
    done(kind === 'u' ? 'Ez a link már nem érvényes.' : 'Ez a link már nem érvényes. Iratkozz fel újra a trippo.hu oldalon.');
  }
});
