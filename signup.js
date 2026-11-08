'use strict';
/* Newsletter sign-up on the homepage. The newsletter function mails a confirmation; nothing is
   subscribed until its button on hirlevel.html is pressed. */
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('signup');
  if (!form) return;
  const message = document.getElementById('signup-message');
  const button = form.querySelector('button');
  const say = (text) => {
    message.textContent = text;
  };
  // A wrong address: say why, mark the field for screen readers, and put the cursor back in it.
  const wrong = (text) => {
    form.email.setAttribute('aria-invalid', 'true');
    form.email.setAttribute('aria-describedby', 'signup-message');
    form.email.focus();
    say(text);
  };
  form.email.addEventListener('input', () => form.email.removeAttribute('aria-invalid'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.email.value.trim();
    if (!email) return wrong('Írd be az e-mail-címed.');
    if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email)) return wrong('Ez nem tűnik e-mail-címnek. Nézd meg, nincs-e benne elírás.');
    button.disabled = true;
    try {
      const res = await fetch('https://rudnmzhfgnynlmjdrwoy.supabase.co/functions/v1/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscribe: email, website: form.website.value, source: 'home' }),
      });
      const { status } = await res.json();
      if (status === 'check') {
        say('Küldtünk egy levelet. A benne lévő gombbal erősítsd meg a feliratkozást.');
        form.email.value = '';
      } else if (status === 'invalid') wrong('Ez nem tűnik e-mail-címnek. Nézd meg, nincs-e benne elírás.');
      else say('Most nem sikerült. Próbáld újra később.');
    } catch {
      say('Most nem sikerült. Van internet?');
    } finally {
      button.disabled = false;
    }
  });
});
