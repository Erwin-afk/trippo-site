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
  message.textContent = 'Ez a link nem teljes vagy elírták. Nyisd meg újra a levélből, vagy másold be az egészet.';
  button.classList.add('hidden');
}

button.addEventListener('click', async () => {
  button.disabled = true;
  let status;
  try {
    const res = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: token }) });
    ({ status } = await res.json());
  } catch {
    // No answer: the link may be fine, so the button stays for another try.
    message.textContent = 'Nem értük el a szervert. Van internet? Próbáld újra.';
    button.disabled = false;
    return;
  }
  message.textContent = status === 'confirmed' ? 'Köszönjük! A lezárt hónapokat ezentúl e-mailben kapod.' : 'Ez a link már nem érvényes. Kérj újat az ügyfeledtől.';
  button.classList.add('hidden');
});
