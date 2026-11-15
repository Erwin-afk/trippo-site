'use strict';
/*
 * Switches the driver e-mails off (link in every one: emlekezteto#o=<token>). The token stays in the
 * #fragment, so it never reaches a server log, and it takes a button press: mail scanners open
 * links, but they don't press buttons.
 */
const FN = 'https://rudnmzhfgnynlmjdrwoy.supabase.co/functions/v1/driver-emails';
const [kind, token] = location.hash.slice(1).split('=');
const message = document.getElementById('message');
const button = document.getElementById('go');
const done = (text) => {
  message.textContent = text;
  button.classList.add('hidden');
};

if (kind !== 'o' || !/^[0-9a-f]{64}$/.test(token ?? '')) {
  done('Ez a link nem teljes vagy elírták. Nyisd meg újra a levélből, vagy kapcsold ki az appban: Beállítások › Értesítések › E-mail emlékeztetők.');
}

button.addEventListener('click', async () => {
  button.disabled = true;
  let status;
  try {
    const res = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ off: token }) });
    ({ status } = await res.json());
  } catch {
    message.textContent = 'Nem értük el a szervert. Van internet? Próbáld újra.';
    button.disabled = false;
    return;
  }
  if (status === 'off') done('Kikapcsoltad. Több emlékeztetőt nem küldünk e-mailben. Az appban, az Értesítések között visszakapcsolhatod.');
  else done('Ez a link már nem érvényes. Kapcsold ki az appban: Beállítások › Értesítések › E-mail emlékeztetők.');
});
