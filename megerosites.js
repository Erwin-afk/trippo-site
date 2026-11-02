'use strict';
/*
 * A report recipient confirms here. The secret stays in the #fragment, so it never reaches a server
 * log, and it takes a button press: mail scanners open links, but they don't press buttons.
 */
const FN = 'https://rudnmzhfgnynlmjdrwoy.supabase.co/functions/v1/send-report';
const token = location.hash.slice(1);
const button = document.getElementById('confirm');
const message = document.getElementById('message');

if (!/^[0-9a-f]{64}$/.test(token)) {
  message.textContent = 'Ez a link nem érvényes.';
  button.classList.add('hidden');
}

button.addEventListener('click', async () => {
  button.disabled = true;
  try {
    const res = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: token }) });
    const { status } = await res.json();
    if (status !== 'confirmed') throw new Error(status);
    message.textContent = 'Köszönjük! A lezárt hónapokat ezentúl e-mailben kapod.';
    button.classList.add('hidden');
  } catch {
    message.textContent = 'Ez a link már nem érvényes. Kérj újat az ügyfeledtől.';
    button.classList.add('hidden');
  }
});
